/**
 * 非敏感配置的仓储。
 *
 * 与 ApiKeyStore 分离：本模块**永远不接触 API Key**，因此可以放心地被
 * UI 与测试引用。两者使用不同的存储键，互不影响——
 * 「清空配置」不会误删 Key，「删除 Key」也不会清掉服务商设置。
 */
import type { Result } from '../shared/result';
import type { KeyValueStore } from '../storage/types';
import { STORAGE_KEYS } from './constants';
import { DEFAULT_SETTINGS, parseAppSettings } from './schema';
import type { AppSettings } from './types';

export class SettingsRepository {
  constructor(private readonly store: KeyValueStore) {}

  /**
   * 读取配置。
   *
   * 存储内容缺失或损坏时回落到默认配置，而不是抛错——
   * 这保证扩展在存储被外部破坏时仍能启动到「未配置」状态。
   */
  async get(): Promise<AppSettings> {
    let raw: unknown;
    try {
      raw = await this.store.get(STORAGE_KEYS.settings);
    } catch {
      return DEFAULT_SETTINGS;
    }

    const parsed = parseAppSettings(raw);
    return parsed.ok ? parsed.value : DEFAULT_SETTINGS;
  }

  /** 校验并保存完整配置；校验失败时不落盘。 */
  async save(input: unknown): Promise<Result<AppSettings>> {
    const parsed = parseAppSettings(input);
    if (!parsed.ok) return parsed;

    await this.store.set(STORAGE_KEYS.settings, parsed.value);
    return { ok: true, value: parsed.value };
  }

  /**
   * 只更新服务商相关部分，保留其它设置。
   *
   * `allowInsecureLocalBaseUrl` 需与 Base URL 一起校验（http 是否放行取决于它），
   * 所以允许在同一次调用中显式更新。
   */
  async saveProvider(
    provider: unknown,
    allowInsecureLocalBaseUrl?: unknown,
  ): Promise<Result<AppSettings>> {
    const current = await this.get();

    const providerInput =
      typeof provider === 'object' && provider !== null && !Array.isArray(provider)
        ? (provider as Record<string, unknown>)
        : {};

    return this.save({
      provider: { ...current.provider, ...providerInput },
      allowInsecureLocalBaseUrl:
        typeof allowInsecureLocalBaseUrl === 'boolean'
          ? allowInsecureLocalBaseUrl
          : current.allowInsecureLocalBaseUrl,
      memoryEnabled: current.memoryEnabled,
      pushPanelContent: current.pushPanelContent,
    });
  }

  /** 只更新面板停靠方式，保留其它设置。 */
  async saveLayout(pushPanelContent: unknown): Promise<Result<AppSettings>> {
    const current = await this.get();

    return this.save({
      provider: current.provider,
      allowInsecureLocalBaseUrl: current.allowInsecureLocalBaseUrl,
      memoryEnabled: current.memoryEnabled,
      pushPanelContent:
        typeof pushPanelContent === 'boolean' ? pushPanelContent : current.pushPanelContent,
    });
  }
}
