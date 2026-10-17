/**
 * 响应信封的解析与错误类型。
 *
 * 刻意不依赖任何浏览器 API，因此可以在 Node 环境直接单测——
 * 「后台返回畸形数据」这类边界不该需要启动浏览器才能验证。
 */
import type { MessageErrorCode } from './types';

export type ClientErrorCode = MessageErrorCode | 'transport_error';

export class MessageError extends Error {
  readonly code: ClientErrorCode;

  constructor(code: ClientErrorCode, message: string) {
    super(message);
    this.name = 'MessageError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把后台返回值解析为数据，失败时抛出可直接展示的 MessageError。
 *
 * 采用白名单式判断：只有 `ok === true` 且确实带有 data 才算成功；
 * 其余一律按失败处理，绝不把畸形响应当成「没有数据但成功」。
 */
export function unwrapEnvelope<T>(raw: unknown): T {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    throw new MessageError('transport_error', '扩展返回了无法识别的响应。');
  }

  if (raw.ok === true) {
    if (!('data' in raw)) {
      throw new MessageError('transport_error', '扩展返回了空响应。');
    }
    return raw.data as T;
  }

  const error = isRecord(raw.error) ? raw.error : null;
  const code = typeof error?.code === 'string' ? error.code : 'internal_error';
  const message = typeof error?.message === 'string' ? error.message : '未知错误。';

  throw new MessageError(code as ClientErrorCode, message);
}

/** 把任意异常转成可展示的文案，避免把底层细节泄露到界面。 */
export function toDisplayMessage(error: unknown, fallback = '操作失败，请重试。'): string {
  if (error instanceof MessageError) return error.message;
  return fallback;
}
