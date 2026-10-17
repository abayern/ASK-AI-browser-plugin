/**
 * 全局长度与数值上限。
 *
 * 这些常量同时被「消息校验」与「配置 Schema」使用，集中在一处，
 * 避免两层校验出现上限不一致而留下绕过空间。
 */
export const LIMITS = {
  /** 单次划词的最大字符数。超出部分不会被发送给模型。 */
  selectionMaxChars: 20_000,
  /** 用户补充问题的最大字符数。 */
  questionMaxChars: 4_000,
  /** 服务商显示名称最大长度。 */
  providerNameMaxChars: 64,
  /** 用户配置的模型标识最大长度。 */
  modelMaxChars: 128,
  /** API Base URL 最大长度。 */
  baseUrlMaxChars: 2_048,
  /** API Key 最大长度（仅作上限保护，不代表任何服务商的真实长度）。 */
  apiKeyMaxChars: 2_048,
  /** API Key 最小长度，低于此值视为无效输入。 */
  apiKeyMinChars: 8,
  /** API Key 长度达到该阈值时才在脱敏显示中保留末 4 位。 */
  apiKeyVisibleThreshold: 8,
  /** temperature 允许范围。 */
  temperatureMin: 0,
  temperatureMax: 2,
} as const;
