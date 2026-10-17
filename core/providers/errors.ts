/**
 * 错误归一化。
 *
 * 设计原则（对应任务书 §4.2）：
 * - 只能向用户展示「状态码 + 错误类别 + 脱敏文案」；
 * - 绝不把响应体原样抛给界面——响应体可能回显请求头，进而泄露 Key；
 * - 不同服务商对同一状态码的解释并不一致，因此文案只描述类别，
 *   不臆断具体原因。
 */

export type ProviderErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'aborted'
  | 'incomplete_stream'
  | 'invalid_response'
  | 'unknown';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

/** 面向用户的固定文案：稳定、可预期、不含任何请求细节。 */
const MESSAGES: Record<ProviderErrorCode, string> = {
  not_configured: '尚未完成配置，请先在设置页填写服务商与 API Key。',
  unauthorized: 'API Key 无效或已失效，请到设置页检查后重新填写。',
  forbidden: '该 API Key 无权访问这个模型或接口。',
  rate_limited: '请求过于频繁，已被服务商限流，请稍后再试。',
  quota_exceeded: '额度不足或已超出配额，请检查服务商账户余额。',
  invalid_request: '服务商认为请求不合法，请检查模型名称与参数。',
  model_not_found: '模型不存在，或当前账号无权访问该模型。',
  server_error: '服务商侧发生错误，请稍后重试。',
  network_error: '网络请求失败，请检查网络连接后重试。',
  timeout: '请求超时，服务商在限定时间内没有完成响应。',
  aborted: '已停止生成。',
  incomplete_stream: '响应在传输中断开，回答可能不完整。',
  invalid_response: '服务商返回了无法解析的响应。',
  unknown: '请求失败，请稍后重试。',
};

export function messageForCode(code: ProviderErrorCode): string {
  return MESSAGES[code];
}

/** 按 HTTP 状态码归类。故意不区分同一状态码的不同语义。 */
export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 402) return 'quota_exceeded';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

/**
 * 从错误响应体里提取一个**安全的**短标识（如 `insufficient_quota`）。
 *
 * 只接受形如标识符的字符串，长度受限；任何包含空格、引号、换行的内容
 * 一律丢弃。这样既能在 UI 上给出一点线索，又不会把响应体（可能回显请求头）
 * 带进界面或日志。
 */
export function extractSafeErrorDetail(body: string): string | null {
  if (body.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const error = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).error
    : undefined;

  const candidates = [
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>).code : undefined,
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>).type : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** 构造一个 HTTP 状态错误；detail 仅作后缀提示，必须已脱敏。 */
export function httpError(status: number, detail: string | null): ProviderError {
  const code = codeForStatus(status);
  const base = `${messageForCode(code)}（HTTP ${status}）`;
  return new ProviderError(code, detail ? `${base} 错误标识：${detail}` : base, status);
}
