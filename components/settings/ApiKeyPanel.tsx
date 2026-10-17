import { useState } from 'react';

import type { ApiKeySummary } from '../../core/config/types';

interface ApiKeyPanelProps {
  summary: ApiKeySummary;
  pending: boolean;
  onSave: (apiKey: string) => Promise<boolean>;
  onClear: () => Promise<boolean>;
}

/**
 * API Key 管理。
 *
 * 三条硬性约束体现为界面行为：
 * 1. 已保存的 Key **永远不回填**到输入框——页面根本拿不到明文；
 * 2. 默认只展示脱敏摘要（涂黑条 + 末四位）；
 * 3. 「删除」是独立操作，不与保存混在一起。
 */
export function ApiKeyPanel({ summary, pending, onSave, onClear }: ApiKeyPanelProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const showEditor = !summary.configured || editing;

  async function handleSave() {
    setLocalError(null);
    const value = draft.trim();
    if (value === '') {
      setLocalError('请输入 API Key。');
      return;
    }

    const saved = await onSave(value);
    if (saved) {
      // 成功后立刻清空本地状态，不把明文留在内存与 DOM 里。
      setDraft('');
      setEditing(false);
      setReveal(false);
    }
  }

  async function handleClear() {
    const confirmed = window.confirm(
      '删除 API Key 后，模型请求会立即停止工作，直到你重新填写。确定删除吗？',
    );
    if (!confirmed) return;

    setLocalError(null);
    const cleared = await onClear();
    if (cleared) {
      setDraft('');
      setEditing(false);
      setReveal(false);
    }
  }

  return (
    <div className="key">
      {summary.configured && !editing ? (
        <>
          <div className="key__strip" aria-label="已保存的 API Key（已脱敏）">
            <span className="key__dots">{summary.masked ?? '••••••••'}</span>
            <span className="key__tag">已保存</span>
          </div>
          <p className="field__hint">
            {summary.updatedAt
              ? `更新于 ${new Date(summary.updatedAt).toLocaleString()}。`
              : null}
            完整 Key 不会再次显示在页面上。
          </p>
          <div className="actions">
            <button
              className="button"
              type="button"
              onClick={() => {
                setEditing(true);
                setDraft('');
                setReveal(false);
              }}
              disabled={pending}
            >
              替换 Key
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={handleClear}
              disabled={pending}
            >
              删除 Key
            </button>
          </div>
        </>
      ) : null}

      {showEditor ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="apiKey">
              {summary.configured ? '新的 API Key' : 'API Key'}
            </label>
            <div className="key__input-row">
              <input
                id="apiKey"
                className="input input--mono"
                type={reveal ? 'text' : 'password'}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="粘贴你的 API Key"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
              />
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-pressed={reveal}
              >
                {reveal ? '隐藏' : '显示'}
              </button>
            </div>
            <p className="field__hint">
              Key 只会保存在本机扩展存储中，并直接发送给你在上方配置的服务商。
            </p>
          </div>

          <div className="actions">
            <button
              className="button button--primary"
              type="button"
              onClick={handleSave}
              disabled={pending}
            >
              {pending ? '保存中…' : '保存 Key'}
            </button>
            {summary.configured ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft('');
                  setReveal(false);
                  setLocalError(null);
                }}
                disabled={pending}
              >
                取消
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {localError ? (
        <p className="notice notice--error" role="alert">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
