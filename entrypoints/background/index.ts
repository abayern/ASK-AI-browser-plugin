/**
 * 扩展后台：**唯一**允许读取 API Key 并（后续阶段）发起模型请求的可信上下文。
 *
 * 消息链路：设置页 / 侧边栏 → background → 校验来源与载荷 → 读写存储。
 * Content Script 只能发消息，永远拿不到也无法设置 API Key。
 */
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { SettingsRepository } from '../../core/config/repository';
import { ApiKeyStore } from '../../core/config/secret';
import {
  classifySender,
  isAllowedFrom,
  parseRequestMessage,
  type SenderDescriptor,
} from '../../core/messaging/guard';
import type {
  ConfigStatus,
  Envelope,
  MessageErrorCode,
  RequestMessage,
} from '../../core/messaging/types';
import { createWxtStorageStore } from '../../core/storage/wxt-store';

function failure(code: MessageErrorCode, message: string): Envelope<never> {
  return { ok: false, error: { code, message } };
}

export default defineBackground(() => {
  const store = createWxtStorageStore();
  const settings = new SettingsRepository(store);
  const apiKeys = new ApiKeyStore(store);

  /** 组装给 UI 看的状态快照：只有脱敏后的 Key 摘要，没有明文。 */
  async function readStatus(): Promise<ConfigStatus> {
    const [current, apiKey] = await Promise.all([settings.get(), apiKeys.summary()]);
    return {
      provider: current.provider,
      apiKey,
      allowInsecureLocalBaseUrl: current.allowInsecureLocalBaseUrl,
      memoryEnabled: current.memoryEnabled,
    };
  }

  async function handle(message: RequestMessage): Promise<Envelope<unknown>> {
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

    try {
      return await handle(parsed.value);
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

  // 点击工具栏图标直接打开设置页。
  // 当前阶段还没有侧边栏/页内面板，这是用户进入设置的唯一入口。
  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
});
