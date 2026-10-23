/**
 * 扩展后台：**唯一**允许读取 API Key 并（后续阶段）发起模型请求的可信上下文。
 *
 * 消息链路：设置页 / 侧边栏 → background → 校验来源与载荷 → 读写存储。
 * Content Script 只能发消息，永远拿不到也无法设置 API Key。
 */
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { createChatSession } from '../../core/chat/session';
import { SettingsRepository } from '../../core/config/repository';
import { ApiKeyStore } from '../../core/config/secret';
import {
  classifySender,
  isAllowedFrom,
  parseRequestMessage,
  type SenderDescriptor,
} from '../../core/messaging/guard';
import { CHAT_PORT_NAME } from '../../core/messaging/chat-protocol';
import type {
  ConfigStatus,
  Envelope,
  MessageErrorCode,
  RequestMessage,
} from '../../core/messaging/types';
import { createOpenAiCompatibleAdapter } from '../../core/providers/openai-compatible';
import { PendingSelectionStore, PENDING_SELECTION_TTL_MS } from '../../core/selection/pending';
import { createWxtStorageStore } from '../../core/storage/wxt-store';

function failure(code: MessageErrorCode, message: string): Envelope<never> {
  return { ok: false, error: { code, message } };
}

export default defineBackground(() => {
  const store = createWxtStorageStore();
  const settings = new SettingsRepository(store);
  const apiKeys = new ApiKeyStore(store);

  /**
   * 暂存各标签页最新选区，供扩展 origin 的面板取用。
   * 刻意只放在内存里：这些是网页正文片段，没有落盘的必要。
   */
  const pendingSelections = new PendingSelectionStore();

  // 定期清掉过期项，避免用户长期不打开面板时内存里堆着网页正文。
  setInterval(() => pendingSelections.prune(), PENDING_SELECTION_TTL_MS);

  /** 组装给 UI 看的状态快照：只有脱敏后的 Key 摘要，没有明文。 */
  async function readStatus(): Promise<ConfigStatus> {
    const [current, apiKey] = await Promise.all([settings.get(), apiKeys.summary()]);
    return {
      provider: current.provider,
      apiKey,
      allowInsecureLocalBaseUrl: current.allowInsecureLocalBaseUrl,
      memoryEnabled: current.memoryEnabled,
      pushPanelContent: current.pushPanelContent,
    };
  }

  async function handle(
    message: RequestMessage,
    tabId: number | undefined,
  ): Promise<Envelope<unknown>> {
    switch (message.type) {
      case 'config/getStatus':
        return { ok: true, data: await readStatus() };

      case 'config/saveProvider': {
        const saved = await settings.saveProvider(
          message.payload.provider,
          message.payload.allowInsecureLocalBaseUrl,
        );
        if (!saved.ok) return failure('validation_failed', saved.error.message);
        return { ok: true, data: await readStatus() };
      }

      case 'config/saveApiKey': {
        const saved = await apiKeys.writeApiKey(message.payload.apiKey);
        if (!saved.ok) return failure('validation_failed', saved.error.message);
        return { ok: true, data: await readStatus() };
      }

      case 'config/clearApiKey': {
        await apiKeys.clearApiKey();
        return { ok: true, data: await readStatus() };
      }

      case 'config/saveLayout': {
        const saved = await settings.saveLayout(message.payload.pushPanelContent);
        if (!saved.ok) return failure('validation_failed', saved.error.message);
        return { ok: true, data: await readStatus() };
      }

      case 'selection/set': {
        // 没有 tabId 说明不是来自某个标签页，无法归属，直接拒绝。
        if (typeof tabId !== 'number') {
          return failure('unauthorized_origin', '无法确定消息所属的标签页。');
        }
        pendingSelections.set(tabId, message.payload.text, message.payload.preset ?? null);

        // 顺带把面板停靠方式带回去，省掉内容脚本再多问一次。
        const current = await settings.get();
        return {
          ok: true,
          data: {
            stored: true,
            length: message.payload.text.length,
            pushPanelContent: current.pushPanelContent,
          },
        };
      }

      case 'panel/getSelection': {
        // 面板本身就在标签页里，用它的 tabId 取回该页暂存的选区与预设动作。
        if (typeof tabId !== 'number') {
          return { ok: true, data: { selection: null, preset: null } };
        }
        return {
          ok: true,
          data: {
            selection: pendingSelections.get(tabId),
            preset: pendingSelections.getPreset(tabId),
          },
        };
      }
    }
  }

  async function dispatch(raw: unknown, sender: SenderDescriptor | undefined): Promise<Envelope<unknown>> {
    const origin = classifySender(sender, browser.runtime.id);
    if (origin === null) {
      return failure('unauthorized_origin', '消息来源不可信，已拒绝。');
    }

    const parsed = parseRequestMessage(raw);
    if (!parsed.ok) {
      return failure('invalid_message', parsed.error.message);
    }

    if (!isAllowedFrom(parsed.value.type, origin)) {
      return failure('unauthorized_origin', '当前来源无权执行该操作。');
    }

    const tabId = sender?.tab && typeof sender.tab === 'object'
      ? (sender.tab as { id?: number }).id
      : undefined;

    try {
      return await handle(parsed.value, tabId);
    } catch {
      // 刻意不打印原始异常：错误对象可能包含请求细节甚至凭证。
      return failure('internal_error', '扩展内部错误，请稍后重试。');
    }
  }

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    void dispatch(raw, sender as SenderDescriptor).then(sendResponse);
    // 返回 true：告知浏览器将异步调用 sendResponse。
    return true;
  });

  // ---- 聊天流式通道 ----
  // 模型请求只在这里发起：Content Script 永远不直接请求服务商，
  // 也拿不到 API Key。通道只对扩展页开放（阶段 4 的面板将以扩展 origin 的
  // iframe 渲染，因此同样满足该条件）。
  const adapter = createOpenAiCompatibleAdapter();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT_NAME) return;

    const origin = classifySender(
      port.sender as SenderDescriptor | undefined,
      browser.runtime.id,
    );
    if (origin !== 'extension-page') {
      port.disconnect();
      return;
    }

    const session = createChatSession(port, {
      loadCredentials: async () => ({
        settings: await settings.get(),
        apiKey: await apiKeys.readApiKey(),
      }),
      adapter,
    });

    port.onMessage.addListener((message: unknown) => session.handleMessage(message));
    port.onDisconnect.addListener(() => session.dispose());
  });
});
