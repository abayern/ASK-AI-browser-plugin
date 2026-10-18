import { describe, expect, it } from 'vitest';

import {
  classifySender,
  isAllowedFrom,
  parseRequestMessage,
} from '../../core/messaging/guard';
import { REQUEST_TYPES } from '../../core/messaging/types';

const EXTENSION_ID = 'abcdefghijklmnop';
const OPTIONS_URL = 'chrome-extension://abcdefghijklmnop/options.html';
const FIREFOX_OPTIONS_URL = 'moz-extension://2f9a1c/options.html';

describe('classifySender', () => {
  it('拒绝 id 不匹配的发送方（防止其它扩展冒用）', () => {
    expect(classifySender({ id: 'other-extension', url: OPTIONS_URL }, EXTENSION_ID)).toBeNull();
    expect(classifySender(undefined, EXTENSION_ID)).toBeNull();
    expect(classifySender({}, EXTENSION_ID)).toBeNull();
  });

  it('回归：以 open_in_tab 打开时扩展页也带 tab，仍必须判定为扩展页', () => {
    // 曾经的实现用「有没有 tab」判断来源，导致设置页把自己当成内容脚本而拒绝。
    expect(
      classifySender({ id: EXTENSION_ID, url: OPTIONS_URL, tab: {} }, EXTENSION_ID),
    ).toBe('extension-page');
  });

  it('不带 tab 的扩展页同样判定为扩展页', () => {
    expect(classifySender({ id: EXTENSION_ID, url: OPTIONS_URL }, EXTENSION_ID)).toBe(
      'extension-page',
    );
  });

  it('sender.url 缺失时用 tab.url 兜底判定扩展页', () => {
    expect(classifySender({ id: EXTENSION_ID, tab: { url: OPTIONS_URL } }, EXTENSION_ID)).toBe(
      'extension-page',
    );
  });

  it('Firefox 的 moz-extension 页面也判定为扩展页', () => {
    expect(
      classifySender(
        { id: EXTENSION_ID, url: FIREFOX_OPTIONS_URL, tab: {} },
        EXTENSION_ID,
      ),
    ).toBe('extension-page');
  });

  it('网页中的内容脚本判定为 content-script', () => {
    expect(
      classifySender(
        { id: EXTENSION_ID, url: 'https://example.com/page', tab: { url: 'https://example.com/page' } },
        EXTENSION_ID,
      ),
    ).toBe('content-script');
  });

  it('网页地址里夹带扩展 origin 字样也无法冒充扩展页', () => {
    expect(
      classifySender(
        { id: EXTENSION_ID, url: `https://evil.test/${OPTIONS_URL}`, tab: {} },
        EXTENSION_ID,
      ),
    ).toBe('content-script');
  });

  it('既非扩展页又无 tab 的来源按不可信拒绝', () => {
    expect(classifySender({ id: EXTENSION_ID, url: 'https://example.com/' }, EXTENSION_ID)).toBeNull();
    expect(classifySender({ id: EXTENSION_ID }, EXTENSION_ID)).toBeNull();
  });
});

describe('isAllowedFrom', () => {
  it('内容脚本对全部配置类消息一律无权', () => {
    const configTypes = REQUEST_TYPES.filter((type) => type !== 'selection/set');
    expect(configTypes.length).toBeGreaterThan(0);

    for (const type of configTypes) {
      expect(isAllowedFrom(type, 'content-script'), type).toBe(false);
    }
  });

  it('内容脚本只被允许提交选区这一件事', () => {
    expect(isAllowedFrom('selection/set', 'content-script')).toBe(true);
  });

  it('扩展页可以调用全部消息类型', () => {
    for (const type of REQUEST_TYPES) {
      expect(isAllowedFrom(type, 'extension-page'), type).toBe(true);
    }
  });
});

describe('parseRequestMessage', () => {
  it('接受合法的无载荷消息', () => {
    expect(parseRequestMessage({ type: 'config/getStatus' }).ok).toBe(true);
    expect(parseRequestMessage({ type: 'config/clearApiKey' }).ok).toBe(true);
  });

  it('接受合法的 selection/set 并去掉首尾空白', () => {
    const result = parseRequestMessage({ type: 'selection/set', payload: { text: '  一段文字  ' } });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'selection/set') {
      expect(result.value.payload.text).toBe('一段文字');
    }
  });

  it('拒绝空、非字符串或超长的选区', () => {
    const badPayloads: unknown[] = [
      {},
      { text: '' },
      { text: '   ' },
      { text: 42 },
      { text: null },
      { text: 'a'.repeat(30_000) },
    ];
    for (const payload of badPayloads) {
      expect(
        parseRequestMessage({ type: 'selection/set', payload }).ok,
        JSON.stringify(payload).slice(0, 24),
      ).toBe(false);
    }
  });

  it('selection/set 不接受夹带的额外字段', () => {
    const result = parseRequestMessage({
      type: 'selection/set',
      payload: { text: '文字', tabId: 999, url: 'https://evil.test' },
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('evil.test');
    expect(serialized).not.toContain('tabId');
  });

  it('拒绝非对象输入', () => {
    for (const bad of [null, undefined, 'config/getStatus', 42, []]) {
      expect(parseRequestMessage(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('拒绝未知消息类型', () => {
    for (const type of ['unknown', '', 'config/deleteEverything', 'chat/send']) {
      expect(parseRequestMessage({ type }).ok, type).toBe(false);
    }
  });

  it('拒绝缺少或非法 payload', () => {
    expect(parseRequestMessage({ type: 'config/saveApiKey' }).ok).toBe(false);
    expect(parseRequestMessage({ type: 'config/saveApiKey', payload: {} }).ok).toBe(false);
    expect(parseRequestMessage({ type: 'config/saveApiKey', payload: { apiKey: 42 } }).ok).toBe(
      false,
    );
    expect(
      parseRequestMessage({ type: 'config/saveProvider', payload: { provider: 'nope' } }).ok,
    ).toBe(false);
  });

  it('拒绝超长 API Key', () => {
    const result = parseRequestMessage({
      type: 'config/saveApiKey',
      payload: { apiKey: 'a'.repeat(3000) },
    });
    expect(result.ok).toBe(false);
  });

  it('只保留已知字段，夹带的额外属性不进入后续流程', () => {
    const result = parseRequestMessage({
      type: 'config/saveApiKey',
      payload: { apiKey: 'sk-1234567890abcdef', extra: 'x', __proto__: { polluted: true } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).toEqual(['type', 'payload']);
      expect(JSON.stringify(result.value)).not.toContain('extra');
      expect(JSON.stringify(result.value)).not.toContain('polluted');
    }
  });

  it('接受合法的 saveProvider 并过滤额外字段', () => {
    const result = parseRequestMessage({
      type: 'config/saveProvider',
      payload: {
        provider: {
          providerName: ' DeepSeek ',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          temperature: 0.5,
          requestHeaders: { Authorization: 'evil' },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'config/saveProvider') {
      const provider = result.value.payload.provider;
      expect(provider.providerName).toBe('DeepSeek');
      expect(provider.temperature).toBe(0.5);
      // 请求头不能由消息指定
      expect(JSON.stringify(result.value)).not.toContain('Authorization');
    }
  });

  it('拒绝越界 temperature', () => {
    for (const temperature of [-1, 5, Number.POSITIVE_INFINITY, 'hot']) {
      const result = parseRequestMessage({
        type: 'config/saveProvider',
        payload: {
          provider: { providerName: 'A', baseUrl: 'https://a.com/v1', model: 'm', temperature },
        },
      });
      expect(result.ok, String(temperature)).toBe(false);
    }
  });

  it('拒绝非布尔 allowInsecureLocalBaseUrl', () => {
    const result = parseRequestMessage({
      type: 'config/saveProvider',
      payload: {
        provider: { providerName: 'A', baseUrl: 'https://a.com/v1', model: 'm' },
        allowInsecureLocalBaseUrl: 'yes',
      },
    });
    expect(result.ok).toBe(false);
  });

  it('拒绝空字符串字段', () => {
    const result = parseRequestMessage({
      type: 'config/saveProvider',
      payload: { provider: { providerName: '   ', baseUrl: 'https://a.com/v1', model: 'm' } },
    });
    expect(result.ok).toBe(false);
  });
});
