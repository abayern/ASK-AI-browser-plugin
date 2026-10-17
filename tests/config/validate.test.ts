import { describe, expect, it } from 'vitest';

import {
  containsSecret,
  maskApiKey,
  normalizeBaseUrl,
  validateApiKey,
} from '../../core/config/validate';

describe('normalizeBaseUrl', () => {
  it('接受 https 地址并去掉末尾斜杠', () => {
    const result = normalizeBaseUrl('https://api.openai.com/v1/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://api.openai.com/v1');
      expect(result.insecureLocalDev).toBe(false);
    }
  });

  it('保留路径且做 trim', () => {
    const result = normalizeBaseUrl('  https://api.example.com/openai/v1  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://api.example.com/openai/v1');
  });

  it('空字符串被拒绝', () => {
    const result = normalizeBaseUrl('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty');
  });

  it('含空格被拒绝', () => {
    const result = normalizeBaseUrl('https://api.example.com/a b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('whitespace');
  });

  it('非法 URL 被拒绝', () => {
    const result = normalizeBaseUrl('not-a-url');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_url');
  });

  it('非 https/http 协议被拒绝', () => {
    const result = normalizeBaseUrl('ftp://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_protocol');
  });

  it('URL 中带用户名口令被拒绝', () => {
    const result = normalizeBaseUrl('https://user:pass@api.example.com/v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('has_credentials');
  });

  it('URL 中带查询参数被拒绝（避免参数注入）', () => {
    const result = normalizeBaseUrl('https://api.example.com/v1?key=abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('has_query');
  });

  it('URL 中带片段被拒绝', () => {
    const result = normalizeBaseUrl('https://api.example.com/v1#frag');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('has_hash');
  });

  it('超长 URL 被拒绝', () => {
    const result = normalizeBaseUrl(`https://example.com/${'a'.repeat(3000)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too_long');
  });

  it('默认拒绝 http 地址', () => {
    const result = normalizeBaseUrl('http://localhost:11434/v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('insecure_http_blocked');
  });

  it('显式允许时放行 http 回环地址', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const result = normalizeBaseUrl(`http://${host}:11434/v1`, {
        allowInsecureLocalDev: true,
      });
      expect(result.ok, host).toBe(true);
      if (result.ok) expect(result.insecureLocalDev).toBe(true);
    }
  });

  it('即使允许本地开发，也拒绝非回环的 http 地址', () => {
    for (const url of ['http://api.example.com/v1', 'http://192.168.1.5:8080/v1']) {
      const result = normalizeBaseUrl(url, { allowInsecureLocalDev: true });
      expect(result.ok, url).toBe(false);
      if (!result.ok) expect(result.code).toBe('insecure_http_blocked');
    }
  });
});

describe('validateApiKey', () => {
  it('接受正常的 Key 并 trim', () => {
    const result = validateApiKey('  sk-1234567890abcdef  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('sk-1234567890abcdef');
  });

  it('非字符串被拒绝', () => {
    expect(validateApiKey(12345).ok).toBe(false);
    expect(validateApiKey(null).ok).toBe(false);
    expect(validateApiKey({}).ok).toBe(false);
  });

  it('空值被拒绝', () => {
    const result = validateApiKey('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty');
  });

  it('过短的 Key 被拒绝', () => {
    const result = validateApiKey('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_short');
  });

  it('超长的 Key 被拒绝', () => {
    const result = validateApiKey('a'.repeat(3000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_long');
  });

  it('拒绝含空白/控制字符的 Key（阻断 Authorization 头注入）', () => {
    for (const bad of [
      'sk-1234 567890abcdef',
      'sk-1234567890abc\ndef',
      'sk-1234567890abc\rdef',
      'sk-1234567890abc\tdef',
    ]) {
      const result = validateApiKey(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_chars');
    }
  });
});

describe('maskApiKey', () => {
  it('足够长时只显示末 4 位', () => {
    const key = 'sk-1234567890abcdef';
    const masked = maskApiKey(key);
    expect(masked).toBe('••••••••cdef');
    expect(masked).not.toContain(key);
    // 脱敏结果不应包含完整的密钥主体
    expect(masked).not.toContain('1234567890');
  });

  it('过短的 Key 不展示任何尾字符', () => {
    expect(maskApiKey('abcdefg')).toBe('••••••••');
  });
});

describe('containsSecret', () => {
  it('能发现被拼进 URL 的 Key', () => {
    const key = 'sk-1234567890abcdef';
    expect(containsSecret(`https://api.example.com/v1?k=${key}`, key)).toBe(true);
    expect(containsSecret('https://api.example.com/v1', key)).toBe(false);
  });

  it('过短的 secret 不做判断，避免误报', () => {
    expect(containsSecret('anything-abc', 'abc')).toBe(false);
  });
});
