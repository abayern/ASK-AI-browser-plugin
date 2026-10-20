/**
 * 配置领域内的纯类型定义。
 *
 * 刻意不含任何 zod、WXT 或浏览器 API 引用，方便被消息层、UI 层与测试
 * 同时引用，而不把「读取密钥」的能力顺带传播出去。
 */

/** 用户在设置页填写的服务商配置。 */
export interface ProviderConfig {
  /** 用户可读的服务商名称，仅用于展示。 */
  providerName: string;
  /** 归一化后的 API Base URL（https，或以本地回环 http 例外）。 */
  baseUrl: string;
  /** 模型标识，例如 gpt-4o-mini。 */
  model: string;
  /** 可选采样温度；仅在服务商支持时下发。 */
  temperature?: number;
}

/** 扩展的非敏感设置。 */
export interface AppSettings {
  provider: ProviderConfig;
  /**
   * 本地开发例外开关：允许把 Base URL 指向 http 回环地址。
   * 默认关闭，且即使开启也只放行 localhost / 127.0.0.1 / [::1]。
   */
  allowInsecureLocalBaseUrl: boolean;
  /** 长期记忆总开关，默认关闭。关闭时不得读取或注入任何记忆。 */
  memoryEnabled: boolean;
  /**
   * 面板停靠方式：true 时页面右侧让出空间（挤压式），面板不再遮挡网页内容。
   * false 时为浮层（可能遮住部分内容）。
   *
   * 默认 false：挤压式会改动网页布局，可能破坏固定定位的导航栏、全宽画布等
   * 站点，必须由用户显式开启。
   */
  pushPanelContent: boolean;
}

/**
 * API Key 的**可安全展示**摘要。
 *
 * 这里不存在 raw key 字段——不是运行时过滤，而是结构上就没有这个位置。
 */
export interface ApiKeySummary {
  configured: boolean;
  /** 形如 `••••••••abcd`；未配置时为 null。 */
  masked: string | null;
  updatedAt: number | null;
}
