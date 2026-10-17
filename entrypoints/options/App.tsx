import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { ApiKeyPanel } from '../../components/settings/ApiKeyPanel';
import { PrivacyNotice } from '../../components/settings/PrivacyNotice';
import { ProviderForm, type ProviderFormValues } from '../../components/settings/ProviderForm';
import { Section } from '../../components/settings/Section';
import { configClient, toDisplayMessage } from '../../core/messaging/client';
import type { ConfigStatus } from '../../core/messaging/types';

export default function App() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 首次读取配置。
  // setState 一律放在 await 之后，避免在 effect 体内同步更新状态引发级联渲染；
  // active 标记用于抵挡 StrictMode 的重复挂载与卸载后的写入。
  useEffect(() => {
    let active = true;

    async function loadInitialStatus() {
      try {
        const next = await configClient.getStatus();
        if (active) setStatus(next);
      } catch (cause) {
        if (active) setError(toDisplayMessage(cause, '读取配置失败，请重新加载页面。'));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadInitialStatus();

    return () => {
      active = false;
    };
  }, []);

  const handleProviderSubmit = useCallback(async (values: ProviderFormValues) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await configClient.saveProvider({
        provider: {
          providerName: values.providerName,
          baseUrl: values.baseUrl,
          model: values.model,
          ...(values.temperature === undefined ? {} : { temperature: values.temperature }),
        },
        allowInsecureLocalBaseUrl: values.allowInsecureLocalBaseUrl,
      });
      setStatus(next);
      setNotice('服务商配置已保存。');
      return true;
    } catch (cause) {
      setError(toDisplayMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const handleApiKeySave = useCallback(async (apiKey: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await configClient.saveApiKey(apiKey));
      setNotice('API Key 已保存。');
      return true;
    } catch (cause) {
      setError(toDisplayMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const handleApiKeyClear = useCallback(async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      setStatus(await configClient.clearApiKey());
      setNotice('API Key 已删除，后续请求将不会使用任何 Key。');
      return true;
    } catch (cause) {
      setError(toDisplayMessage(cause));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const version = browser.runtime.getManifest().version;

  return (
    <div className="page">
      <header className="masthead">
        <p className="masthead__eyebrow">划词问 AI · 设置</p>
        <h1 className="masthead__title">用你自己的 Key，问你自己的模型</h1>
        <p className="masthead__lede">
          本扩展没有服务器：配置只保存在这台设备上，请求从浏览器直接发往你填写的服务商。
        </p>
      </header>

      {error ? (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="banner banner--ok" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="loading">正在读取本机配置…</p>
      ) : status ? (
        <>
          <Section
            label="01 / 服务商"
            title="模型服务"
            description="填你实际要用的 OpenAI-compatible 服务。请求只会发往这里的地址。"
          >
            <ProviderForm
              // 仅在服务商配置真正变化后重建表单，避免「保存 Key」时丢失未提交的输入
              key={`${status.provider.providerName}|${status.provider.baseUrl}|${status.provider.model}`}
              initial={status.provider}
              allowInsecureLocalBaseUrl={status.allowInsecureLocalBaseUrl}
              pending={pending}
              onSubmit={handleProviderSubmit}
            />
          </Section>

          <Section
            label="02 / 凭证"
            title="API Key"
            description="只保存在本机扩展存储中，不会上传到任何本产品的服务器。"
          >
            <ApiKeyPanel
              summary={status.apiKey}
              pending={pending}
              onSave={handleApiKeySave}
              onClear={handleApiKeyClear}
            />
          </Section>

          <Section
            label="03 / 边界"
            title="隐私与数据"
            description="在把任何内容发出去之前，你应该知道它去哪、谁在处理。"
          >
            <PrivacyNotice />
          </Section>
        </>
      ) : null}

      <footer className="colophon">
        <span>划词问 AI v{version}</span>
        <span>本地存储 · 无账号 · 无遥测</span>
      </footer>
    </div>
  );
}
