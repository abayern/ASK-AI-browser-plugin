/**
 * 扩展本地存储使用的键名。
 *
 * 安全设计要点：
 * - API Key 使用**独立键**，与普通配置物理分离，不混存在同一个对象里。
 * - 键名带 `.v1` 后缀，便于将来做存储迁移而不误读旧结构。
 * - 这里只有键名，不含任何凭证。
 */
export const STORAGE_KEYS = {
  /** 非敏感配置：服务商、Base URL、模型名等。 */
  settings: 'settings.v1',
  /** 唯一的敏感键：API Key。仅 background 可读写。 */
  apiKey: 'secret.apiKey.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
