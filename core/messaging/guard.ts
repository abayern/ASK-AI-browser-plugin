/**
 * 消息的运行时校验与来源判定。
 *
 * 「消息来自扩展运行环境」并不等于「消息可信」：扩展的 Content Script 同样
 * 运行在网页里，可能被网页内容诱导发送任意消息。因此这里做三件事：
 *   1. 判定发送方身份（扩展页 vs 内容脚本）；
 *   2. 按类型查白名单决定该身份能否执行该操作；
 *   3. 逐字段校验载荷类型与长度上限，超限直接拒绝。
 */
import { LIMITS } from '../shared/limits';
import { isRecord, type Result } from '../shared/result';
import { isRequestType, type RequestMessage, type RequestType } from './types';

/** 发送方身份。 */
export type MessageOrigin = 'extension-page' | 'content-script';

/**
 * 各消息类型允许的来源。
 *
 * 当前所有消息都是配置读写，因此**只有扩展页可用**；
 * Content Script 永远无权读写配置或触碰 API Key。
 * 将来新增聊天类消息时，需在此显式放开给 content-script。
 */
const ORIGIN_POLICY: Record<RequestType, readonly MessageOrigin[]> = {
  'config/getStatus': ['extension-page'],
  'config/saveProvider': ['extension-page'],
  'config/saveApiKey': ['extension-page'],
  'config/clearApiKey': ['extension-page'],
};

/** 从 browser.runtime.MessageSender 中抽取判定所需的最小字段。 */
export interface SenderDescriptor {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { url?: string | undefined } | undefined;
}

/**
 * 扩展页面使用的 URL scheme。
 * Chrome/Edge 为 chrome-extension://，Firefox 为 moz-extension://。
 */
const EXTENSION_SCHEME_PATTERN = /^(?:chrome|moz|safari-web)-extension:\/\//i;

/**
 * 判定发送方身份。
 *
 * 关键点一：**不能用「有没有 tab」来区分**。
 * 设置页以 `open_in_tab` 打开时，Chrome 同样会填充 `sender.tab`，
 * 若据此判断就会把自家的扩展页误判成内容脚本而拒绝。
 *
 * 关键点二：`sender.id` 与 `sender.url` 都由浏览器填写，网页脚本无法伪造。
 * 既然 `sender.id` 已经确认是**本扩展**，再看 `sender.url` 的 scheme
 * 就能安全地区分「本扩展自己的页面」与「注入了本扩展内容脚本的网页」：
 * - 扩展页（设置页 / 侧边栏）：`url` 为 chrome-extension:// 或 moz-extension://；
 * - 内容脚本：`url` 是所在网页的地址（http/https/file）。
 *
 * 返回 null 表示身份不可信或无法判定，调用方必须拒绝。
 */
export function classifySender(
  sender: SenderDescriptor | undefined,
  extensionId: string,
): MessageOrigin | null {
  if (!sender) return null;
  if (typeof sender.id !== 'string' || sender.id !== extensionId) return null;

  const url = typeof sender.url === 'string' ? sender.url : '';
  const tabUrl = typeof sender.tab?.url === 'string' ? sender.tab.url : '';

  if (EXTENSION_SCHEME_PATTERN.test(url)) return 'extension-page';

  // 兜底：个别情况下 sender.url 可能缺失，但标签页地址仍是扩展页。
  // 扩展 scheme 无法被网页伪造，因此这里放宽不会引入冒充风险。
  if (EXTENSION_SCHEME_PATTERN.test(tabUrl)) return 'extension-page';

  if (sender.tab !== undefined) return 'content-script';

  // 既非扩展页、又无 tab：无法判定，按不可信处理。
  return null;
}

/** 该来源是否可以发送该类型的消息。 */
export function isAllowedFrom(type: RequestType, origin: MessageOrigin): boolean {
  return ORIGIN_POLICY[type].includes(origin);
}

function reject(message: string): Result<never, { code: string; message: string }> {
  return { ok: false, error: { code: 'invalid_message', message } };
}

/** 读取必填字符串字段，并施加长度上限。 */
function readString(
  source: Record<string, unknown>,
  key: string,
  max: number,
): Result<string, { code: string; message: string }> {
  const value = source[key];
  if (typeof value !== 'string') {
    return reject(`字段 ${key} 必须是字符串。`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return reject(`字段 ${key} 不能为空。`);
  }
  if (trimmed.length > max) {
    return reject(`字段 ${key} 超过最大长度 ${max}。`);
  }
  return { ok: true, value: trimmed };
}

/**
 * 把未知输入解析为受信任的 RequestMessage。
 *
 * 只挑出已知字段重新构造对象（而非透传原对象），因此载荷里夹带的
 * 额外属性不会进入后续流程。
 */
export function parseRequestMessage(
  raw: unknown,
): Result<RequestMessage, { code: string; message: string }> {
  if (!isRecord(raw)) {
    return reject('消息必须是对象。');
  }

  const type = raw.type;
  if (typeof type !== 'string' || !isRequestType(type)) {
    return reject('未知的消息类型。');
  }

  switch (type) {
    case 'config/getStatus':
      return { ok: true, value: { type } };

    case 'config/clearApiKey':
      return { ok: true, value: { type } };

    case 'config/saveApiKey': {
      const payload = isRecord(raw.payload) ? raw.payload : null;
      if (!payload) return reject('缺少 payload。');

      const apiKey = payload.apiKey;
      if (typeof apiKey !== 'string') return reject('apiKey 必须是字符串。');
      if (apiKey.length > LIMITS.apiKeyMaxChars) {
        return reject(`API Key 不能超过 ${LIMITS.apiKeyMaxChars} 个字符。`);
      }

      return { ok: true, value: { type, payload: { apiKey } } };
    }

    case 'config/saveProvider': {
      const payload = isRecord(raw.payload) ? raw.payload : null;
      if (!payload) return reject('缺少 payload。');

      const provider = isRecord(payload.provider) ? payload.provider : null;
      if (!provider) return reject('缺少 provider。');

      const providerName = readString(provider, 'providerName', LIMITS.providerNameMaxChars);
      if (!providerName.ok) return providerName;

      const baseUrl = readString(provider, 'baseUrl', LIMITS.baseUrlMaxChars);
      if (!baseUrl.ok) return baseUrl;

      const model = readString(provider, 'model', LIMITS.modelMaxChars);
      if (!model.ok) return model;

      const rawTemperature = provider.temperature;
      let temperature: number | undefined;
      if (rawTemperature !== undefined) {
        if (
          typeof rawTemperature !== 'number' ||
          !Number.isFinite(rawTemperature) ||
          rawTemperature < LIMITS.temperatureMin ||
          rawTemperature > LIMITS.temperatureMax
        ) {
          return reject(
            `temperature 必须是 ${LIMITS.temperatureMin} 到 ${LIMITS.temperatureMax} 之间的数字。`,
          );
        }
        temperature = rawTemperature;
      }

      const rawInsecure = payload.allowInsecureLocalBaseUrl;
      if (rawInsecure !== undefined && typeof rawInsecure !== 'boolean') {
        return reject('allowInsecureLocalBaseUrl 必须是布尔值。');
      }

      return {
        ok: true,
        value: {
          type,
          payload: {
            provider: {
              providerName: providerName.value,
              baseUrl: baseUrl.value,
              model: model.value,
              ...(temperature === undefined ? {} : { temperature }),
            },
            ...(rawInsecure === undefined ? {} : { allowInsecureLocalBaseUrl: rawInsecure }),
          },
        },
      };
    }
  }
}
