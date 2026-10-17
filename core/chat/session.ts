/**
 * 后台的聊天会话逻辑。
 *
 * 刻意只依赖两个可注入的协作者（读配置、适配器）和一个极简 port 接口，
 * 因此取消、错误映射、并发请求隔离这些行为都能用单测覆盖，
 * 不需要真的启动浏览器或连网。
 */
import type { AppSettings } from '../config/types';
import { messageForCode, ProviderError } from '../providers/errors';
import type { ProviderAdapter } from '../providers/types';
import {
  parseChatClientMessage,
  type ChatServerMessage,
} from '../messaging/chat-protocol';
import { buildChatMessages } from './context';

export interface ChatCredentials {
  settings: AppSettings;
  /** 未配置时为 null。 */
  apiKey: string | null;
}

export interface ChatSessionDeps {
  loadCredentials(): Promise<ChatCredentials>;
  adapter: ProviderAdapter;
}

/** 只依赖 postMessage，方便在测试里用假 port。 */
export interface ChatPortLike {
  postMessage(message: unknown): void;
}

export interface ChatSession {
  handleMessage(raw: unknown): void;
  /** 端口断开或后台卸载时调用：终止所有进行中的请求。 */
  dispose(): void;
}

export function createChatSession(port: ChatPortLike, deps: ChatSessionDeps): ChatSession {
  const running = new Map<string, AbortController>();

  function post(message: ChatServerMessage): void {
    try {
      port.postMessage(message);
    } catch {
      // 端口已断开：静默丢弃，避免后台因界面关闭而抛错。
    }
  }

  function postError(requestId: string, code: string, message: string): void {
    post({ type: 'chat/error', payload: { requestId, error: { code, message } } });
  }

  async function start(
    requestId: string,
    question: string,
    selection: string | undefined,
    recent: Parameters<typeof buildChatMessages>[0]['recent'],
  ): Promise<void> {
    // 同一个 requestId 重复发起时忽略，避免并行重复计费。
    if (running.has(requestId)) return;

    const controller = new AbortController();
    running.set(requestId, controller);

    try {
      const { settings, apiKey } = await deps.loadCredentials();
      if (!apiKey) {
        postError(requestId, 'not_configured', messageForCode('not_configured'));
        return;
      }

      const messages = buildChatMessages({ question, selection, recent });

      const stream = deps.adapter.streamChat({
        baseUrl: settings.provider.baseUrl,
        apiKey,
        model: settings.provider.model,
        ...(settings.provider.temperature === undefined
          ? {}
          : { temperature: settings.provider.temperature }),
        allowInsecureLocalDev: settings.allowInsecureLocalBaseUrl,
        messages,
        signal: controller.signal,
      });

      for await (const delta of stream) {
        if (controller.signal.aborted) break;
        if (delta.text.length > 0) {
          post({ type: 'chat/delta', payload: { requestId, text: delta.text } });
        }
      }

      if (controller.signal.aborted) {
        postError(requestId, 'aborted', messageForCode('aborted'));
      } else {
        post({ type: 'chat/done', payload: { requestId } });
      }
    } catch (error) {
      // 只把归一化后的 code/message 传给界面，绝不传原始异常对象。
      if (error instanceof ProviderError) {
        postError(requestId, error.code, error.message);
      } else {
        postError(requestId, 'unknown', messageForCode('unknown'));
      }
    } finally {
      running.delete(requestId);
    }
  }

  return {
    handleMessage(raw: unknown): void {
      const parsed = parseChatClientMessage(raw);
      // 畸形消息静默丢弃：不值得为它向界面报错，也不应中断已有请求。
      if (!parsed.ok) return;

      const message = parsed.value;
      if (message.type === 'chat/abort') {
        running.get(message.payload.requestId)?.abort();
        return;
      }

      void start(
        message.payload.requestId,
        message.payload.question,
        message.payload.selection,
        message.payload.recent,
      );
    },

    dispose(): void {
      for (const controller of running.values()) controller.abort();
      running.clear();
    },
  };
}
