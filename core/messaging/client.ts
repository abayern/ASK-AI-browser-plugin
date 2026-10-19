/**
 * UI 侧的消息客户端。
 *
 * 只依赖 `browser.runtime.sendMessage`，不引用任何密钥模块，
 * 因此设置页 / 侧边栏都可以安全导入。
 *
 * 解析逻辑放在 envelope.ts（纯函数），本文件只负责传输，
 * 这样「畸形响应处理」可以脱离浏览器单测。
 */
import { browser } from 'wxt/browser';

import { MessageError, unwrapEnvelope } from './envelope';
import type { ConfigStatus, RequestMessage } from './types';

export { MessageError, toDisplayMessage, unwrapEnvelope } from './envelope';
export type { ClientErrorCode } from './envelope';

async function request<T>(message: RequestMessage): Promise<T> {
  let raw: unknown;
  try {
    raw = await browser.runtime.sendMessage(message);
  } catch {
    // 后台可能已被浏览器回收，或页面刚重载；不把底层错误细节抛给界面。
    throw new MessageError('transport_error', '无法连接扩展后台，请重新加载本页后重试。');
  }
  return unwrapEnvelope<T>(raw);
}

export const configClient = {
  getStatus(): Promise<ConfigStatus> {
    return request<ConfigStatus>({ type: 'config/getStatus' });
  },

  saveProvider(payload: {
    provider: {
      providerName: string;
      baseUrl: string;
      model: string;
      temperature?: number;
    };
    allowInsecureLocalBaseUrl?: boolean;
  }): Promise<ConfigStatus> {
    return request<ConfigStatus>({ type: 'config/saveProvider', payload });
  },

  saveApiKey(apiKey: string): Promise<ConfigStatus> {
    return request<ConfigStatus>({ type: 'config/saveApiKey', payload: { apiKey } });
  },

  clearApiKey(): Promise<ConfigStatus> {
    return request<ConfigStatus>({ type: 'config/clearApiKey' });
  },

  /** 面板启动时取回当前标签页暂存的选区。 */
  getSelection(): Promise<{ selection: string | null }> {
    return request<{ selection: string | null }>({ type: 'panel/getSelection' });
  },
};
