import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import { MarkdownView } from '../../components/panel/MarkdownView';
import { startChatStream, type ChatStream } from '../../core/messaging/chat-client';
import { configClient } from '../../core/messaging/client';
import type { ChatMessage } from '../../core/providers/types';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** 选区预览最多显示的高度（超出折叠）。 */
const SELECTION_COLLAPSED_CHARS = 180;

export default function App() {
  const [selection, setSelection] = useState<string | null>(null);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [modelLabel, setModelLabel] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 缺少配置时把提示做成可点击的入口，而不是让用户自己找设置页。 */
  const [needsConfig, setNeedsConfig] = useState(false);

  const streamRef = useRef<ChatStream | null>(null);
  const bufferRef = useRef('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 载入选区（只需一次）
  useEffect(() => {
    let active = true;

    async function loadSelection() {
      try {
        const selected = await configClient.getSelection();
        if (active) setSelection(selected.selection);
      } catch {
        if (active) setSelection(null);
      }
    }

    void loadSelection();
    return () => {
      active = false;
    };
  }, []);

  // 读取配置状态。
  // 面板重新获得焦点时再读一次：用户去设置页填完 Key 切回来，提示会自动消失。
  useEffect(() => {
    let active = true;

    async function refreshStatus() {
      try {
        const status = await configClient.getStatus();
        if (!active) return;
        setModelLabel(`${status.provider.providerName} · ${status.provider.model}`);
        setNeedsConfig(!status.apiKey.configured);
      } catch {
        // 配置状态只是辅助展示，取不到就不改动现有状态。
      }
    }

    void refreshStatus();

    // 用户去设置页填完再切回来时，两种事件都可能先到：
    // focus 在面板重新获得焦点时触发，visibilitychange 在标签页重新可见时触发。
    function onVisible() {
      if (document.visibilityState === 'visible') void refreshStatus();
    }

    window.addEventListener('focus', refreshStatus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.removeEventListener('focus', refreshStatus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 有新内容时滚到底部
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns, streamText]);

  // 面板被移除时中止请求，避免后台继续跑
  useEffect(
    () => () => {
      streamRef.current?.dispose();
    },
    [],
  );

  // Esc 收起面板：与「×」走同一条关闭路径，由父页面校验来源后执行。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        window.parent.postMessage({ type: 'ask-ai-panel/close' }, '*');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const send = useCallback(
    (question: string) => {
      if (busy) return;

      const trimmed = question.trim();
      if (trimmed === '' && selection === null) {
        setError('请输入问题，或先选中一段文字。');
        return;
      }

      // 只选中文字、没写问题时，用一句默认提问，避免空请求。
      const effectiveQuestion = trimmed === '' ? '解释这段文字' : trimmed;

      setError(null);
      setNotice(null);
      setBusy(true);
      setStreamText('');
      bufferRef.current = '';

      const recent: ChatMessage[] = turns.slice(-8).map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));

      setTurns((prev) => [...prev, { role: 'user', content: effectiveQuestion }]);

      const finish = (content: string) => {
        const finalText = content;
        bufferRef.current = '';
        setStreamText('');
        if (finalText !== '') {
          setTurns((prev) => [...prev, { role: 'assistant', content: finalText }]);
        }
        setBusy(false);
        streamRef.current = null;
      };

      streamRef.current = startChatStream(
        {
          question: effectiveQuestion,
          ...(selection === null ? {} : { selection }),
          recent,
        },
        {
          onDelta: (text) => {
            bufferRef.current += text;
            setStreamText(bufferRef.current);
          },
          onDone: () => {
            finish(bufferRef.current);
          },
          onError: (chatError) => {
            // 用户主动停止不算错误：保留已经生成的部分。
            if (chatError.code === 'aborted') {
              finish(bufferRef.current);
              setNotice('已停止生成。');
              return;
            }
            finish(bufferRef.current);

            // 未配置属于「去设置一下」而不是错误，改由可点击的提示条呈现，
            // 避免同一个意思在界面上出现两次。
            if (chatError.code === 'not_configured') {
              setNeedsConfig(true);
              return;
            }

            setError(chatError.message);
          },
        },
      );
    },
    [busy, selection, turns],
  );

  function handleStop() {
    streamRef.current?.abort();
  }

  /** 打开设置页。面板是扩展页，因此可以直接调用。 */
  function openSettings() {
    void browser.runtime.openOptionsPage();
  }

  async function handleCopy() {
    const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
    const text = lastAssistant?.content ?? streamText;
    if (text === '') return;

    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制回答。');
    } catch {
      setError('复制失败，请手动选择文本。');
    }
  }

  function handleRetry() {
    const lastUser = [...turns].reverse().find((turn) => turn.role === 'user');
    if (lastUser) send(lastUser.content);
  }

  function handleRequestClose() {
    // 只通知父页面收起面板；父页面会校验消息来源，网页无法伪造。
    window.parent.postMessage({ type: 'ask-ai-panel/close' }, '*');
  }

  /** 收起成侧边小标签，把网页让出来（面板不销毁，可再展开）。 */
  function handleCollapse() {
    window.parent.postMessage({ type: 'ask-ai-panel/collapse' }, '*');
  }

  const truncatedSelection =
    selection !== null &&
    !selectionExpanded &&
    selection.length > SELECTION_COLLAPSED_CHARS;

  return (
    <div className="panel">
      <header className="panel__head">
        <div>
          <p className="panel__title">划词问 AI</p>
          {modelLabel ? <p className="panel__model">{modelLabel}</p> : null}
        </div>
        <div className="panel__actions">
          <button
            className="iconbtn"
            type="button"
            onClick={handleCollapse}
            aria-label="收起面板，让开网页"
            title="收起（让开网页）"
          >
            ‒
          </button>
          <button
            className="iconbtn"
            type="button"
            onClick={handleRequestClose}
            aria-label="关闭面板"
            title="关闭"
          >
            ×
          </button>
        </div>
      </header>

      {selection !== null ? (
        <section className="quote">
          <p className="quote__label">引用文字</p>
          <blockquote className="quote__body">
            {truncatedSelection ? `${selection.slice(0, SELECTION_COLLAPSED_CHARS)}…` : selection}
          </blockquote>
          {selection.length > SELECTION_COLLAPSED_CHARS ? (
            <button
              className="linkbtn"
              type="button"
              onClick={() => setSelectionExpanded((value) => !value)}
            >
              {selectionExpanded ? '收起' : `展开全文（${selection.length} 字）`}
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="thread" ref={scrollRef}>
        {turns.length === 0 && streamText === '' ? (
          <p className="empty">选中文字后在此提问，例如「解释这段话」「总结核心观点」。</p>
        ) : null}

        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <div className="bubble bubble--user" key={`u-${index}`}>
              {turn.content}
            </div>
          ) : (
            <div className="bubble bubble--ai" key={`a-${index}`}>
              <MarkdownView text={turn.content} />
            </div>
          ),
        )}

        {streamText !== '' ? (
          <div className="bubble bubble--ai">
            <MarkdownView text={streamText} />
            <span className="caret" aria-hidden="true" />
          </div>
        ) : null}

        {busy && streamText === '' ? <p className="thinking">正在生成…</p> : null}
      </div>

      {needsConfig ? (
        <button type="button" className="notice notice--action" onClick={openSettings}>
          <span>尚未完成配置，需填写服务商与 API Key。</span>
          <span className="notice__cta">去设置 →</span>
        </button>
      ) : null}

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      <footer className="composer">
        <textarea
          className="composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!busy) {
                send(draft);
                setDraft('');
              }
            }
          }}
          placeholder="补充你的问题，回车发送"
          rows={2}
          maxLength={4000}
        />

        <div className="composer__actions">
          {busy ? (
            <button className="btn btn--danger" type="button" onClick={handleStop}>
              停止生成
            </button>
          ) : (
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => {
                send(draft);
                setDraft('');
              }}
            >
              提问
            </button>
          )}

          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => void handleCopy()}
            disabled={turns.length === 0 && streamText === ''}
          >
            复制
          </button>

          <button
            className="btn btn--ghost"
            type="button"
            onClick={handleRetry}
            disabled={busy || turns.length === 0}
          >
            重试
          </button>
        </div>
      </footer>
    </div>
  );
}
