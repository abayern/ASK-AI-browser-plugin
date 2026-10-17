/**
 * API Key 的唯一读写入口。
 *
 * ⚠️ 安全约束（由 ESLint 与代码评审共同保证）：
 * 本模块**只允许 background 导入**。UI（设置页 / 侧边栏 / Content Script）
 * 一律不得导入它，只能通过 `config/getStatus` 消息拿到脱敏摘要。
 *
 * 其他设计要点：
 * - 不做任何内存缓存：每次请求都重新读存储，因此「清除 Key」立即生效，
 *   不存在残留的运行时缓存让旧 Key 继续被使用。
 * - 读取时重新校验：即便存储被外部篡改，形状或字符非法也会被视为「未配置」。
 */
import type { Result } from '../shared/result';
import type { KeyValueStore } from '../storage/types';
import { STORAGE_KEYS } from './constants';
import type { ApiKeySummary } from './types';
import { isStoredSecret, maskApiKey, validateApiKey } from './validate';

export const EMPTY_API_KEY_SUMMARY: ApiKeySummary = {
  configured: false,
  masked: null,
  updatedAt: null,
};

export class ApiKeyStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * 读取明文 API Key，仅供 background 在发起模型请求时调用。
   *
   * 返回 null 表示「未配置或存储内容不可信」，调用方必须按未配置处理。
   */
  async readApiKey(): Promise<string | null> {
    let raw: unknown;
    try {
      raw = await this.store.get(STORAGE_KEYS.apiKey);
    } catch {
      return null;
    }
    if (!isStoredSecret(raw)) return null;

    const validated = validateApiKey(raw.value);
    return validated.ok ? validated.value : null;
  }

  /** 校验并保存新 Key。失败时不写入任何内容。 */
  async writeApiKey(input: unknown): Promise<Result<ApiKeySummary>> {
    const validated = validateApiKey(input);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }

    const record = { value: validated.value, updatedAt: this.now() };
    await this.store.set(STORAGE_KEYS.apiKey, record);

    return {
      ok: true,
      value: {
        configured: true,
        masked: maskApiKey(validated.value),
        updatedAt: record.updatedAt,
      },
    };
  }

  /** 删除 Key。删除后 readApiKey() 必须返回 null。 */
  async clearApiKey(): Promise<void> {
    await this.store.remove(STORAGE_KEYS.apiKey);
  }

  /** 供 UI 展示的脱敏摘要，绝不含明文。 */
  async summary(): Promise<ApiKeySummary> {
    let raw: unknown;
    try {
      raw = await this.store.get(STORAGE_KEYS.apiKey);
    } catch {
      return EMPTY_API_KEY_SUMMARY;
    }
    if (!isStoredSecret(raw)) return EMPTY_API_KEY_SUMMARY;

    const validated = validateApiKey(raw.value);
    if (!validated.ok) return EMPTY_API_KEY_SUMMARY;

    return {
      configured: true,
      masked: maskApiKey(validated.value),
      updatedAt: raw.updatedAt,
    };
  }
}
