import { useMemo, type MouseEvent } from 'react';
import { browser } from 'wxt/browser';

import { renderMarkdownToSafeHtml } from '../../core/markdown/render';

function escapeToText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 渲染模型回答。
 *
 * `dangerouslySetInnerHTML` 在这里是安全的：内容来自
 * `renderMarkdownToSafeHtml`，它已经做过白名单重建。
 * 万一该函数抛错（例如缺少 DOM），退化为纯文本而不是原样输出。
 *
 * 链接一律拦截：面板是页面里的 iframe，若放任跳转会把问答界面导航走，
 * 因此改用 tabs.create 在新标签页打开。
 */
export function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return renderMarkdownToSafeHtml(text);
    } catch {
      return escapeToText(text);
    }
  }, [text]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a');
    if (!anchor) return;

    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href) return;

    void browser.tabs.create({ url: href });
  }

  return <div className="md" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
