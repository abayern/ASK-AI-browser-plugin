/**
 * 输入校验：API Base URL 与 API Key。
 *
 * 这是整个扩展最关键的安全边界之一，规则如下：
 * - 模型请求地址必须由用户显式配置，且只接受 https。
 * - http 默认拒绝；仅当用户**显式**开启「本地开发例外」且主机确实是回环地址时才放行。
 * - 拒绝 URL 中携带用户名/口令、查询参数、片段，避免把参数拼进请求造成注入。
 * - API Key 禁止空白与控制字符，从根上阻断 Authorization 头的 CRLF 注入。
 */
import { LIMITS } from '../shared/limits';
import { isRecord, type Result } from '../shared/result';

export type BaseUrlErrorCode =
  | 'empty'
  | 'too_long'
  | 'whitespace'
  | 'invalid_url'
  | 'missing_host'
  | 'unsupported_protocol'
  | 'has_credentials'
  | 'has_query'
  | 'has_hash'
  | 'insecure_http_blocked';

export interface BaseUrlAccepted {
  ok: true;
  /** 归一化后的地址（已去除末尾斜杠），供后续拼接请求路径。 */
  url: string;
  /** 是否为「回环地址 + http」的本地开发例外。 */
  insecureLocalDev: boolean;
}

export interface BaseUrlRejected {
  ok: false;
  code: BaseUrlErrorCode;
  message: string;
}

export type BaseUrlResult = BaseUrlAccepted | BaseUrlRejected;

export interface ValidateBaseUrlOptions {
  /**
   * 是否允许 http 回环地址（本地开发）。默认 false。
   * 即使为 true，也**只**放行 localhost / 127.0.0.1 / [::1]，不含局域网地址。
   */
  allowInsecureLocalDev?: boolean;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function reject(code: BaseUrlErrorCode, message: string): BaseUrlRejected {
  return { ok: false, code, message };
}

/**
 * 校验并归一化用户填写的 API Base URL。
 *
 * 注意：本函数不会、也绝不应该接触 API Key。
 */
export function normalizeBaseUrl(
  raw: unknown,
  options: ValidateBaseUrlOptions = {},
): BaseUrlResult {
  if (typeof raw !== 'string') {
    return reject('invalid_url', 'Base URL 必须是字符串。');
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return reject('empty', '请填写 API Base URL。');
  }
  if (trimmed.length > LIMITS.baseUrlMaxChars) {
    return reject('too_long', `Base URL 不能超过 ${LIMITS.baseUrlMaxChars} 个字符。`);
  }
  if (/\s/.test(trimmed)) {
    return reject('whitespace', 'Base URL 不能包含空格或换行。');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return reject('invalid_url', 'Base URL 不是合法的网址。');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return reject('unsupported_protocol', 'Base URL 只支持 https:// 协议。');
  }

  // 用户名/口令会随请求一起发出，且极易被写入日志，一律拒绝。
  if (parsed.username !== '' || parsed.password !== '') {
    return reject('has_credentials', 'Base URL 不能包含用户名或口令。');
  }

  // 查询参数与片段不参与鉴权路径，允许它们只会模糊「请求发往哪里」。
  if (parsed.search !== '') {
    return reject('has_query', 'Base URL 不能包含查询参数（? 之后的内容）。');
  }
  if (parsed.hash !== '') {
    return reject('has_hash', 'Base URL 不能包含片段（# 之后的内容）。');
  }

  if (parsed.hostname === '') {
    return reject('missing_host', 'Base URL 缺少主机名。');
  }

  const isLoopback = LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  const insecureLocalDev = protocol === 'http:';

  if (insecureLocalDev) {
    if (options.allowInsecureLocalDev !== true) {
      return reject(
        'insecure_http_blocked',
        '出于安全考虑，默认拒绝 http:// 地址。请改用 https://。',
      );
    }
    if (!isLoopback) {
      return reject(
        'insecure_http_blocked',
        'http:// 仅允许用于本机回环地址（localhost / 127.0.0.1）。',
      );
    }
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}`, insecureLocalDev };
}

export type ApiKeyErrorCode = 'invalid_type' | 'empty' | 'too_short' | 'too_long' | 'invalid_chars';

/**
 * 校验用户输入的 API Key。
 *
 * 只允许可打印 ASCII（0x21-0x7E）：直接排除空格、制表符、CR/LF 与
 * 其它控制字符，从而杜绝把头注入（header injection）写进 Authorization。
 */
export function validateApiKey(raw: unknown): Result<string, { code: ApiKeyErrorCode; message: string }> {
  if (typeof raw !== 'string') {
    return { ok: false, error: { code: 'invalid_type', message: 'API Key 必须是字符串。' } };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { code: 'empty', message: '请输入 API Key。' } };
  }
  if (trimmed.length < LIMITS.apiKeyMinChars) {
    return {
      ok: false,
      error: {
        code: 'too_short',
        message: `API Key 长度不足，至少需要 ${LIMITS.apiKeyMinChars} 个字符。`,
      },
    };
  }
  if (trimmed.length > LIMITS.apiKeyMaxChars) {
    return {
      ok: false,
      error: {
        code: 'too_long',
        message: `API Key 不能超过 ${LIMITS.apiKeyMaxChars} 个字符。`,
      },
    };
  }
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    return {
      ok: false,
      error: {
        code: 'invalid_chars',
        message: 'API Key 只能包含可见 ASCII 字符，不能有空格或换行。',
      },
    };
  }

  return { ok: true, value: trimmed };
}

/**
 * 生成用于展示的脱敏字符串。
 *
 * 仅在 Key 足够长时保留末 4 位，用于帮助用户辨认「当前是哪一把 Key」，
 * 不足以还原凭证。返回值本身可以安全地展示在 UI 上。
 */
export function maskApiKey(key: string): string {
  const tail =
    key.length >= LIMITS.apiKeyVisibleThreshold ? key.slice(-4) : '';
  return tail.length > 0 ? `••••••••${tail}` : '••••••••';
}

/**
 * 判断某个字符串是否已经包含了这把 Key 的明文。
 *
 * 用途：在真正发出请求前做一次自检，确保 Key 没有被拼进 URL、查询参数
 * 或任何会被记录的位置。
 */
export function containsSecret(haystack: string, secret: string): boolean {
  const needle = secret.trim();
  // 过短的字符串容易误报，只有达到 Key 最小长度才做包含判断。
  if (needle.length < LIMITS.apiKeyMinChars) return false;
  return haystack.includes(needle);
}

/** 判断一个未知值是否是「已存储的 Key 记录」形状。 */
export function isStoredSecret(value: unknown): value is { value: string; updatedAt: number } {
  if (!isRecord(value)) return false;
  return typeof value.value === 'string' && typeof value.updatedAt === 'number';
}
