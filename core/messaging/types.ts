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
  'config/saveLayout',
  'selection/set',
  'panel/getSelection',
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

/** 面板停靠方式：挤压页面（不遮挡）或浮层。 */
export interface SaveLayoutRequest {
  type: 'config/saveLayout';
  payload: { pushPanelContent: boolean };
}

/**
 * Content Script 把选中文字交给后台暂存。
 *
 * 这是**唯一**允许内容脚本调用的消息：它只能写入一段受长度限制的文本，
 * 不能读写配置、不能指定请求地址、也接触不到 API Key。
 */
export interface SelectionSetRequest {
  type: 'selection/set';
  payload: { text: string };
}

export type RequestMessage =
  | GetStatusRequest
  | SaveProviderRequest
  | SaveApiKeyRequest
  | ClearApiKeyRequest
  | SaveLayoutRequest
  | SelectionSetRequest
  | PanelGetSelectionRequest;

/**
 * 面板（扩展 origin 的 iframe）取回当前标签页暂存的选区。
 *
 * 走后台而不是把文本塞进 iframe URL，避免网页正文出现在地址里。
 */
export interface PanelGetSelectionRequest {
  type: 'panel/getSelection';
}

/** `panel/getSelection` 的响应数据。 */
export interface PanelSelectionPayload {
  selection: string | null;
}

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
  pushPanelContent: boolean;
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
