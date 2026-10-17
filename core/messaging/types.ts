/**
 * 扩展内部消息协议。
 *
 * 安全设计：
 * - 请求类型是封闭的白名单常量，guard 只接受这些值。
 * - **响应类型中不存在任何 API Key 明文字段**：会话摘要是
 *   `{ configured, masked, updatedAt }`，从类型层面就不可能把 Key 回传。
 * - 消息只携带完成任务所需的最小参数；URL、请求头、凭证都不能由消息指定，
 *   只能来自 background 读取到的用户配置。
 */
import type { ApiKeySummary, ProviderConfig } from '../config/types';

/** 所有允许的请求类型。新增类型必须同时更新 ORIGIN_POLICY。 */
export const REQUEST_TYPES = [
  'config/getStatus',
  'config/saveProvider',
  'config/saveApiKey',
  'config/clearApiKey',
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export interface GetStatusRequest {
  type: 'config/getStatus';
}

export interface SaveProviderRequest {
  type: 'config/saveProvider';
  payload: {
    provider: ProviderConfig;
    /** 是否允许 http 回环地址（本地开发）。缺省表示保持原值。 */
    allowInsecureLocalBaseUrl?: boolean;
  };
}

export interface SaveApiKeyRequest {
  type: 'config/saveApiKey';
  payload: {
    /** 明文只在「UI → background」这一跳出现，background 立即写入 storage。 */
    apiKey: string;
  };
}

export interface ClearApiKeyRequest {
  type: 'config/clearApiKey';
}

export type RequestMessage =
  | GetStatusRequest
  | SaveProviderRequest
  | SaveApiKeyRequest
  | ClearApiKeyRequest;

/**
 * 设置状态快照——这是 UI 能拿到的全部配置信息。
 *
 * 注意 `apiKey` 的类型是 ApiKeySummary：结构上就没有明文字段。
 */
export interface ConfigStatus {
  provider: ProviderConfig;
  apiKey: ApiKeySummary;
  allowInsecureLocalBaseUrl: boolean;
  memoryEnabled: boolean;
}

export type MessageErrorCode =
  | 'unauthorized_origin'
  | 'invalid_message'
  | 'validation_failed'
  | 'internal_error';

export interface MessageError {
  code: MessageErrorCode;
  message: string;
}

/** 统一响应信封：UI 必须先判断 ok 再取 data。 */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: MessageError };

export function isRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}
