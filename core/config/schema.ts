/**
 * 配置的 Schema 校验。
 *
 * 设计原则：
 * - 所有外部输入（storage 中的旧数据、消息 payload、UI 表单）都视为不可信，
 *   一律先经过本模块校验再进入业务逻辑。
 * - zod 默认丢弃未知字段，因此不会把攻击者塞进来的额外键写回存储。
 * - Base URL 的协议/凭据校验放在对象级 superRefine 中，因为它依赖同级字段
 *   `allowInsecureLocalBaseUrl`。
 */
import { z } from 'zod';

import { LIMITS } from '../shared/limits';
import { isRecord, type Result } from '../shared/result';
import type { AppSettings, ProviderConfig } from './types';
import { normalizeBaseUrl } from './validate';

const providerNameSchema = z
  .string()
  .trim()
  .min(1, '请填写服务商名称。')
  .max(LIMITS.providerNameMaxChars, `服务商名称不能超过 ${LIMITS.providerNameMaxChars} 个字符。`);

const baseUrlSchema = z
  .string()
  .trim()
  .min(1, '请填写 API Base URL。')
  .max(LIMITS.baseUrlMaxChars, `Base URL 不能超过 ${LIMITS.baseUrlMaxChars} 个字符。`);

const modelSchema = z
  .string()
  .trim()
  .min(1, '请填写模型名称。')
  .max(LIMITS.modelMaxChars, `模型名称不能超过 ${LIMITS.modelMaxChars} 个字符。`);

const temperatureSchema = z
  .number()
  .min(LIMITS.temperatureMin, `temperature 不能小于 ${LIMITS.temperatureMin}。`)
  .max(LIMITS.temperatureMax, `temperature 不能大于 ${LIMITS.temperatureMax}。`);

export const providerConfigSchema = z.object({
  providerName: providerNameSchema,
  baseUrl: baseUrlSchema,
  model: modelSchema,
  temperature: temperatureSchema.optional(),
});

export const appSettingsSchema = z
  .object({
    provider: providerConfigSchema,
    allowInsecureLocalBaseUrl: z.boolean(),
    memoryEnabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const result = normalizeBaseUrl(value.provider.baseUrl, {
      allowInsecureLocalDev: value.allowInsecureLocalBaseUrl,
    });
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', path: ['provider', 'baseUrl'], message: result.message });
    }
  });

/**
 * 默认配置模板。
 *
 * 注意：这里只有公开的默认值与占位地址，**不含任何真实 API Key**。
 * Key 必须由用户在设置页自行填写。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  allowInsecureLocalBaseUrl: false,
  memoryEnabled: false,
};

/**
 * 把不可信的已存数据或部分输入补齐为完整结构。
 *
 * 逐字段判断类型而不是直接展开，避免 `null`、字符串或数组把默认值覆盖成
 * 非法结构；嵌套的 provider 同样逐层合并。
 */
function applyDefaults(input: unknown): unknown {
  if (!isRecord(input)) {
    return { ...DEFAULT_SETTINGS, provider: { ...DEFAULT_SETTINGS.provider } };
  }

  const providerInput = isRecord(input.provider) ? input.provider : {};

  return {
    provider: { ...DEFAULT_SETTINGS.provider, ...providerInput },
    allowInsecureLocalBaseUrl:
      typeof input.allowInsecureLocalBaseUrl === 'boolean'
        ? input.allowInsecureLocalBaseUrl
        : DEFAULT_SETTINGS.allowInsecureLocalBaseUrl,
    memoryEnabled:
      typeof input.memoryEnabled === 'boolean'
        ? input.memoryEnabled
        : DEFAULT_SETTINGS.memoryEnabled,
  };
}

/**
 * 校验并归一化一份完整配置。
 *
 * 成功时返回的 baseUrl 已归一化（去尾斜杠、小写协议），后续可以直接拼接
 * 请求路径，不必再做字符串处理。
 */
export function parseAppSettings(input: unknown): Result<AppSettings> {
  const parsed = appSettingsSchema.safeParse(applyDefaults(input));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: { code: 'invalid_settings', message: first?.message ?? '配置格式不正确。' },
    };
  }

  const settings = parsed.data;
  const normalized = normalizeBaseUrl(settings.provider.baseUrl, {
    allowInsecureLocalDev: settings.allowInsecureLocalBaseUrl,
  });
  if (!normalized.ok) {
    return { ok: false, error: { code: normalized.code, message: normalized.message } };
  }

  const provider: ProviderConfig = {
    providerName: settings.provider.providerName,
    baseUrl: normalized.url,
    model: settings.provider.model,
    ...(settings.provider.temperature === undefined
      ? {}
      : { temperature: settings.provider.temperature }),
  };

  return {
    ok: true,
    value: {
      provider,
      allowInsecureLocalBaseUrl: settings.allowInsecureLocalBaseUrl,
      memoryEnabled: settings.memoryEnabled,
    },
  };
}
