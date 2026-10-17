import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, parseAppSettings, providerConfigSchema } from '../../core/config/schema';

describe('parseAppSettings', () => {
  it('空输入回落到默认模板（不含任何真实凭证）', () => {
    const result = parseAppSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.baseUrl).toBe(DEFAULT_SETTINGS.provider.baseUrl);
      expect(result.value.allowInsecureLocalBaseUrl).toBe(false);
      expect(result.value.memoryEnabled).toBe(false);
    }
  });

  it('未知或非法类型的输入也回落到默认值，不会抛错', () => {
    for (const bad of [null, undefined, 'string', 42, [], true]) {
      const result = parseAppSettings(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(true);
    }
  });

  it('接受合法的自定义服务商配置', () => {
    const result = parseAppSettings({
      provider: {
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1/',
        model: 'deepseek-chat',
        temperature: 0.3,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider.providerName).toBe('DeepSeek');
      // 末尾斜杠被归一化去掉
      expect(result.value.provider.baseUrl).toBe('https://api.deepseek.com/v1');
      expect(result.value.provider.temperature).toBe(0.3);
    }
  });

  it('未知字段会被丢弃，不会写回存储', () => {
    const result = parseAppSettings({
      provider: {
        providerName: 'X',
        baseUrl: 'https://api.example.com/v1',
        model: 'm',
        apiKey: 'should-not-survive',
        evil: 'x',
      },
      injected: 'y',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain('should-not-survive');
      expect(serialized).not.toContain('injected');
      expect(serialized).not.toContain('evil');
    }
  });

  it('http 地址默认被拒绝', () => {
    const result = parseAppSettings({
      provider: { providerName: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'llama' },
    });
    expect(result.ok).toBe(false);
  });

  it('显式开启本地开发例外后放行 http 回环地址', () => {
    const result = parseAppSettings({
      provider: { providerName: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'llama' },
      allowInsecureLocalBaseUrl: true,
    });
    expect(result.ok).toBe(true);
  });

  it('temperature 越界被拒绝', () => {
    for (const temperature of [-1, 3, Number.NaN]) {
      const result = parseAppSettings({
        provider: { providerName: 'X', baseUrl: 'https://a.com/v1', model: 'm', temperature },
      });
      expect(result.ok, String(temperature)).toBe(false);
    }
  });

  it('空字符串字段被拒绝', () => {
    const result = parseAppSettings({
      provider: { providerName: '', baseUrl: 'https://a.com/v1', model: 'm' },
    });
    expect(result.ok).toBe(false);
  });
});

describe('providerConfigSchema', () => {
  it('长度上限生效', () => {
    const tooLong = providerConfigSchema.safeParse({
      providerName: 'a'.repeat(65),
      baseUrl: 'https://a.com',
      model: 'm',
    });
    expect(tooLong.success).toBe(false);
  });
});
