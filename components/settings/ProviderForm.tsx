import { useState, type FormEvent } from 'react';

import type { ProviderConfig } from '../../core/config/types';

export interface ProviderFormValues {
  providerName: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  allowInsecureLocalBaseUrl: boolean;
}

interface ProviderFormProps {
  initial: ProviderConfig;
  allowInsecureLocalBaseUrl: boolean;
  pending: boolean;
  onSubmit: (values: ProviderFormValues) => Promise<boolean>;
}

/**
 * 服务商与模型配置表单。
 *
 * 组件只负责收集输入并做「是不是数字」这类即时校验；
 * 真正的安全校验（协议、凭据、长度）由扩展后台的 Schema 统一裁决，
 * 避免前后端两套规则出现分歧。
 */
export function ProviderForm({
  initial,
  allowInsecureLocalBaseUrl,
  pending,
  onSubmit,
}: ProviderFormProps) {
  const [providerName, setProviderName] = useState(initial.providerName);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [temperature, setTemperature] = useState(
    initial.temperature === undefined ? '' : String(initial.temperature),
  );
  const [allowInsecure, setAllowInsecure] = useState(allowInsecureLocalBaseUrl);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const trimmedTemperature = temperature.trim();
    let parsedTemperature: number | undefined;
    if (trimmedTemperature !== '') {
      const candidate = Number(trimmedTemperature);
      if (!Number.isFinite(candidate)) {
        setLocalError('temperature 需要填写数字，或留空。');
        return;
      }
      parsedTemperature = candidate;
    }

    await onSubmit({
      providerName: providerName.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(parsedTemperature === undefined ? {} : { temperature: parsedTemperature }),
      allowInsecureLocalBaseUrl: allowInsecure,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="providerName">
          服务商名称
        </label>
        <input
          id="providerName"
          className="input"
          value={providerName}
          onChange={(event) => setProviderName(event.target.value)}
          placeholder="例如 OpenAI、DeepSeek"
          autoComplete="off"
          maxLength={64}
        />
        <p className="field__hint">只用于本页展示，不影响请求发往哪里。</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="baseUrl">
          API Base URL
        </label>
        <input
          id="baseUrl"
          className="input input--mono"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
          spellCheck={false}
          maxLength={2048}
        />
        <p className="field__hint">
          只接受 https://。请求会直接发往这个地址，不经过本产品的中转服务器。
        </p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="model">
          模型名称
        </label>
        <input
          id="model"
          className="input input--mono"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="例如 gpt-4o-mini"
          autoComplete="off"
          spellCheck={false}
          maxLength={128}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="temperature">
          temperature<span className="field__optional">可选</span>
        </label>
        <input
          id="temperature"
          className="input input--narrow"
          value={temperature}
          onChange={(event) => setTemperature(event.target.value)}
          placeholder="留空表示不发送"
          inputMode="decimal"
          autoComplete="off"
        />
        <p className="field__hint">0 到 2 之间。部分服务商或模型不支持该参数时请留空。</p>
      </div>

      <details className="advanced">
        <summary className="advanced__summary">高级：本地开发服务器</summary>
        <div className="advanced__body">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allowInsecure}
              onChange={(event) => setAllowInsecure(event.target.checked)}
            />
            <span>
              允许通过明文 http 访问<strong>本机</strong>回环地址
            </span>
          </label>
          <p className="field__hint">
            仅用于 localhost / 127.0.0.1 上的本地模型服务。开启后凭据会以明文在本地网络栈传输；
            其它任何 http 地址仍会被拒绝。
          </p>
        </div>
      </details>

      {localError ? (
        <p className="notice notice--error" role="alert">
          {localError}
        </p>
      ) : null}

      <div className="actions">
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending ? '保存中…' : '保存配置'}
        </button>
      </div>
    </form>
  );
}
