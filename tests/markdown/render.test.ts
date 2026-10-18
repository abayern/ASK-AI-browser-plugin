// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { renderMarkdownToSafeHtml } from '../../core/markdown/render';

/** 把结果塞进真实 DOM 再断言，避免只做字符串匹配而漏掉解析层面的问题。 */
function toDom(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('renderMarkdownToSafeHtml · 基本排版', () => {
  it('渲染常见 Markdown 结构', () => {
    const html = renderMarkdownToSafeHtml(
      ['**粗体** 与 *斜体*', '', '- 列表项', '', '`code`', '', '```', 'block', '```', '', '# 标题'].join(
        '\n',
      ),
    );
    const dom = toDom(html);

    expect(dom.querySelector('strong')?.textContent).toBe('粗体');
    expect(dom.querySelector('em')?.textContent).toBe('斜体');
    expect(dom.querySelector('li')?.textContent).toBe('列表项');
    expect(dom.querySelector('h1')?.textContent).toBe('标题');
    expect(dom.querySelectorAll('pre').length).toBeGreaterThan(0);
  });

  it('空输入返回空字符串或安全内容', () => {
    expect(renderMarkdownToSafeHtml('')).toBe('');
  });
});

describe('renderMarkdownToSafeHtml · XSS 防护', () => {
  it('script 标签连同内容整段被丢弃', () => {
    const dom = toDom(renderMarkdownToSafeHtml('<script>alert(1)</script>'));
    expect(dom.querySelector('script')).toBeNull();
    // 连脚本文本都不保留：比转义更彻底
    expect(dom.textContent).not.toContain('alert(1)');
  });

  it('img 的 onerror 注入被消除（且图片整体被禁止）', () => {
    const dom = toDom(renderMarkdownToSafeHtml('<img src=x onerror="alert(1)">'));
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.innerHTML).not.toContain('onerror');
  });

  it('事件属性不会保留', () => {
    const dom = toDom(renderMarkdownToSafeHtml('<a href="https://ok.test" onclick="alert(1)">x</a>'));
    const anchor = dom.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute('onclick')).toBe(false);
  });

  it('javascript: 链接被剥离', () => {
    const dom = toDom(renderMarkdownToSafeHtml('[点我](javascript:alert(1))'));
    const anchor = dom.querySelector('a');
    expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:');
  });

  it('data: 链接被剥离', () => {
    const dom = toDom(
      renderMarkdownToSafeHtml('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'),
    );
    expect(dom.querySelector('a')?.getAttribute('href') ?? '').not.toContain('data:');
  });

  it('iframe / object / embed / style 被移除', () => {
    for (const tag of ['iframe', 'object', 'embed', 'style']) {
      const dom = toDom(renderMarkdownToSafeHtml(`<${tag}></${tag}>`));
      expect(dom.querySelector(tag), tag).toBeNull();
    }
  });

  it('svg 与 math 被移除（避免利用其事件与命名空间）', () => {
    for (const tag of ['svg', 'math']) {
      const dom = toDom(renderMarkdownToSafeHtml(`<${tag}></${tag}>`));
      expect(dom.querySelector(tag), tag).toBeNull();
    }
  });

  it('保留 http / https / mailto 链接', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:a@b.com']) {
      const dom = toDom(renderMarkdownToSafeHtml(`[link](${href})`));
      expect(dom.querySelector('a')?.getAttribute('href'), href).toBe(href);
    }
  });

  it('不保留 target 属性，避免在面板内导航出去', () => {
    const dom = toDom(renderMarkdownToSafeHtml('<a href="https://x.test" target="_blank">x</a>'));
    expect(dom.querySelector('a')?.hasAttribute('target')).toBe(false);
  });

  it('不会引入任何外部资源引用', () => {
    const html = renderMarkdownToSafeHtml('![img](https://evil.test/track.png)');
    const dom = toDom(html);
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.innerHTML).not.toContain('evil.test');
  });
});
