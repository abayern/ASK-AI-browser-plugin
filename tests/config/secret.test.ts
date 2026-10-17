import { describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '../../core/config/constants';
import { ApiKeyStore } from '../../core/config/secret';
import { MemoryStore, ThrowingStore } from '../helpers/memory-store';

const KEY = 'sk-1234567890abcdef';

function createStore(): { store: MemoryStore; apiKeys: ApiKeyStore } {
  const store = new MemoryStore();
  return { store, apiKeys: new ApiKeyStore(store, () => 1_700_000_000_000) };
}

describe('ApiKeyStore', () => {
  it('保存后可以读回明文（仅 background 用）', async () => {
    const { apiKeys } = createStore();
    const result = await apiKeys.writeApiKey(KEY);
    expect(result.ok).toBe(true);
    await expect(apiKeys.readApiKey()).resolves.toBe(KEY);
  });

  it('保存后写入的是独立存储键，且记录含时间戳', async () => {
    const { store, apiKeys } = createStore();
    await apiKeys.writeApiKey(KEY);

    const raw = store.data.get(STORAGE_KEYS.apiKey);
    expect(raw).toEqual({ value: KEY, updatedAt: 1_700_000_000_000 });
  });

  it('summary 只返回脱敏信息，绝不含明文', async () => {
    const { apiKeys } = createStore();
    await apiKeys.writeApiKey(KEY);

    const summary = await apiKeys.summary();
    expect(summary.configured).toBe(true);
    expect(summary.masked).toBe('••••••••cdef');
    expect(summary.updatedAt).toBe(1_700_000_000_000);

    // 序列化后也不应出现明文，防止日志/埋点意外带出
    expect(JSON.stringify(summary)).not.toContain(KEY);
  });

  it('非法 Key 被拒绝且不写入任何内容', async () => {
    const { store, apiKeys } = createStore();

    for (const bad of ['', 'short', 'sk-1234 5678', 'sk-1234567890abc\ndef']) {
      const result = await apiKeys.writeApiKey(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      expect(store.data.has(STORAGE_KEYS.apiKey)).toBe(false);
    }
  });

  it('清除后读取为 null，summary 回到未配置', async () => {
    const { store, apiKeys } = createStore();
    await apiKeys.writeApiKey(KEY);
    expect(await apiKeys.readApiKey()).toBe(KEY);

    await apiKeys.clearApiKey();

    // 关键安全断言：删除后不存在任何残留的可用值
    await expect(apiKeys.readApiKey()).resolves.toBeNull();
    expect(store.data.has(STORAGE_KEYS.apiKey)).toBe(false);

    const summary = await apiKeys.summary();
    expect(summary).toEqual({ configured: false, masked: null, updatedAt: null });
  });

  it('存储被篡改成非法结构时按未配置处理', async () => {
    const cases: unknown[] = [
      { value: 123, updatedAt: 1 },
      { value: KEY },
      { updatedAt: 1 },
      'just-a-string',
      null,
      [KEY],
    ];

    for (const tampered of cases) {
      const store = new MemoryStore({ [STORAGE_KEYS.apiKey]: tampered });
      const apiKeys = new ApiKeyStore(store);
      await expect(apiKeys.readApiKey(), JSON.stringify(tampered)).resolves.toBeNull();
      expect((await apiKeys.summary()).configured).toBe(false);
    }
  });

  it('存储被篡改成含非法字符的 Key 时同样视为未配置', async () => {
    const store = new MemoryStore({
      [STORAGE_KEYS.apiKey]: { value: 'sk-1234 567890abcdef', updatedAt: 1 },
    });
    const apiKeys = new ApiKeyStore(store);
    await expect(apiKeys.readApiKey()).resolves.toBeNull();
  });

  it('存储读取失败时不崩溃，按未配置处理', async () => {
    const apiKeys = new ApiKeyStore(new ThrowingStore());
    await expect(apiKeys.readApiKey()).resolves.toBeNull();
    expect((await apiKeys.summary()).configured).toBe(false);
  });

  it('替换 Key 后读到的是新值', async () => {
    const { apiKeys } = createStore();
    await apiKeys.writeApiKey(KEY);
    await apiKeys.writeApiKey('sk-new-key-0000000000');
    await expect(apiKeys.readApiKey()).resolves.toBe('sk-new-key-0000000000');
  });
});
