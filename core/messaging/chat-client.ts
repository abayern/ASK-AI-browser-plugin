/**
 * UI 侧的聊天流式客户端。
 *
 * 只负责建立 port、发送请求、把服务端事件转成回调。
 * 不引用任何密钥模块——明文 Key 从头到尾只存在于后台。
 */
import { browser } from 'wxt/browser';

import type { ChatMessage } from '../providers/types';
import { CHAT_PORT_NAME } from './chat-protocol';

export interface ChatError {
  code: string;
  message: string;
}

export interface ChatStreamHandlers {
  onDelta(text: string): void;
  onDone(): void;
  onError(error: ChatError): void;
}

export interface ChatStreamInput {
  question: string;
  selection?: string | undefined;
  recent?: readonly ChatMessage[] | undefined;
}

export interface ChatStream {
  /** 让后台中止这次请求（用户点「停止生成」）。 */
  abort(): void;
  /** 断开端口并停止接收事件。 */
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function startChatStream(input: ChatStreamInput, handlers: ChatStreamHandlers): ChatStream {
  const port = browser.runtime.connect({ name: CHAT_PORT_NAME });
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let settled = false;

  function settle(action: () => void): void {
    if (settled) return;
    settled = true;
    action();
  }

  port.onMessage.addListener((raw: unknown) => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return;
    const payload = isRecord(raw.payload) ? raw.payload : null;
    if (!payload || payload.requestId !== requestId) return;

    switch (raw.type) {
      case 'chat/delta': {
        if (typeof payload.text === 'string' && payload.text.length > 0) {
          handlers.onDelta(payload.text);
        }
        break;
      }
      case 'chat/done': {
        settle(() => handlers.onDone());
        break;
      }
      case 'chat/error': {
        const error = isRecord(payload.error) ? payload.error : null;
        settle(() =>
          handlers.onError({
            code: typeof error?.code === 'string' ? error.code : 'unknown',
            message: typeof error?.message === 'string' ? error.message : '请求失败。',
          }),
        );
        break;
      }
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    // 后台被回收（例如 MV3 service worker 休眠）时不会收到 done，按失败收尾。
    settle(() =>
      handlers.onError({
        code: 'transport_error',
        message: '与扩展后台的连接已断开，请重试。',
      }),
    );
  });

  port.postMessage({
    type: 'chat/start',
    payload: {
      requestId,
      question: input.question,
      ...(input.selection === undefined ? {} : { selection: input.selection }),
      ...(input.recent === undefined ? {} : { recent: [...input.recent] }),
    },
  });

  return {
    abort(): void {
      try {
        port.postMessage({ type: 'chat/abort', payload: { requestId } });
      } catch {
        // 端口已断开，无需再中止。
      }
    },
    dispose(): void {
      settled = true;
      try {
        port.disconnect();
      } catch {
        // 已断开时忽略。
      }
    },
  };
}
