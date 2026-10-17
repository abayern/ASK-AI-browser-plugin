/**
 * 供应商无关的聊天类型。
 *
 * UI 与后台只依赖这些类型，不感知具体服务商的差异；
 * 适配器负责把各自协议的细节收敛到这一层。
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 流式增量。适配器每解析出一段就 yield 一次。 */
export interface ChatDelta {
  text: string;
}

export interface ChatRequest {
  /** 已归一化的 Base URL（https，或以本地回环 http 例外）。 */
  baseUrl: string;
  /** 明文 Key。只在 background 内存中短暂存在，绝不出现在 URL / 日志 / 错误里。 */
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** 是否允许 http 回环地址；与配置中的本地开发开关一致。 */
  allowInsecureLocalDev?: boolean;
  /** 外部取消信号（用户点「停止生成」）。 */
  signal?: AbortSignal;
  /** 整体超时，默认 120 秒。 */
  timeoutMs?: number;
}

/**
 * 统一适配器接口。
 *
 * 用 async generator 表达流：调用方 `for await` 消费增量，
 * 出错时由适配器抛出 `ProviderError`，中断时通过 `return()` 关闭迭代器。
 */
export interface ProviderAdapter {
  /** 适配器标识，用于日志与后续多供应商扩展。 */
  readonly id: string;
  streamChat(request: ChatRequest): AsyncGenerator<ChatDelta, void, void>;
}
