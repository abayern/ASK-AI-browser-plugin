import { describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '../../core/config/constants';
import { SettingsRepository } from '../../core/config/repository';
import { DEFAULT_SETTINGS } from '../../core/config/schema';
import { MemoryStore, ThrowingStore } from '../helpers/memory-store';

describe('SettingsRepository', () => {
  it('从未保存过时返回默认配置', async () => {
    const repo = new SettingsRepository(new MemoryStore());
    await expect(repo.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('保存后可以读回', async () => {
    const repo = new SettingsRepository(new MemoryStore());
    const saved = await repo.save({
      provider: {
        providerName: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2',
      },
      allowInsecureLocalBaseUrl: false,
      memoryEnabled: true,
    });

    expect(saved.ok).toBe(true);
    const current = await repo.get();
    expect(current.provider.providerName).toBe('Moonshot');
    expect(current.memoryEnabled).toBe(true);
  });

  it('校验失败时不落盘', async () => {
    const store = new MemoryStore();
    const repo = new SettingsRepository(store);

    const result = await repo.save({
      provider: { providerName: 'X', baseUrl: 'http://localhost:1/v1', model: 'm' },
    });

    expect(result.ok).toBe(false);
    expect(store.data.has(STORAGE_KEYS.settings)).toBe(false);
  });

  it('saveProvider 只改服务商，保留其它设置', async () => {
    const repo = new SettingsRepository(new MemoryStore());
    await repo.save({
      provider: { providerName: 'A', baseUrl: 'https://a.com/v1', model: 'm1' },
      memoryEnabled: true,
    });

    const result = await repo.saveProvider({
      providerName: 'B',
      baseUrl: 'https://b.com/v1',
      model: 'm2',
    });

    expect(result.ok).toBe(true);
    const current = await repo.get();
    expect(current.provider.providerName).toBe('B');
    expect(current.provider.model).toBe('m2');
    // 未被触及的字段应保留
    expect(current.memoryEnabled).toBe(true);
  });

  it('saveProvider 可以显式开启本地开发例外', async () => {
    const repo = new SettingsRepository(new MemoryStore());

    // 先确认默认拒绝
    const rejected = await repo.saveProvider({
      providerName: 'Local',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
    });
    expect(rejected.ok).toBe(false);

    const accepted = await repo.saveProvider(
      { providerName: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
      true,
    );
    expect(accepted.ok).toBe(true);
  });

  it('存储内容损坏时回落到默认配置', async () => {
    for (const corrupt of ['garbage', 42, { provider: 'nope' }, []]) {
      const store = new MemoryStore({ [STORAGE_KEYS.settings]: corrupt });
      const repo = new SettingsRepository(store);
      const current = await repo.get();
      expect(current.provider.baseUrl, JSON.stringify(corrupt)).toBe(
        DEFAULT_SETTINGS.provider.baseUrl,
      );
    }
  });

  it('存储读取失败时不崩溃', async () => {
    const repo = new SettingsRepository(new ThrowingStore());
    await expect(repo.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('配置仓储不接触 API Key 存储键', async () => {
    const store = new MemoryStore();
    const repo = new SettingsRepository(store);
    await repo.saveProvider({ providerName: 'A', baseUrl: 'https://a.com/v1', model: 'm' });

    // 清空配置不应删掉 Key，反之亦然——这里验证键完全隔离
    expect(store.data.has(STORAGE_KEYS.apiKey)).toBe(false);
    expect(store.data.has(STORAGE_KEYS.settings)).toBe(true);
  });
});
