/**
 * HTML 白名单消毒：解析后**重建**，而不是过滤原树。
 *
 * 为什么自己写而不是用 DOMPurify：在本项目的构建/测试链里，
 * DOMPurify 出现了「同一实例、同一份配置、不同输入，允许列表与禁止列表颠倒」
 * 的行为（`<p>` 被剥掉、`<img>` 反而保留），排查后无法稳定复现其内部状态。
 * 安全清洗不能依赖行为不确定的组件，因此改为这个不依赖任何单例状态的实现。
 *
 * 安全依据：
 * - 在 `<template>` 的**惰性内容**里解析：脚本不执行、图片与外部资源不加载；
 * - 输出是**全新构造**的节点树，原始节点从不被插入文档，因此不存在
 *   「先插入再清理」的时间窗；
 * - 标签与属性都走白名单，未知标签只保留其文本化子内容；
 * - 链接协议只允许 http / https / mailto，其余（javascript:、data:、vbscript: 等）
 *   连同属性一起丢弃。
 */

/** 允许保留的排版标签。 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

/**
 * 连同内容一起丢弃的标签。
 *
 * 这些标签要么能执行代码（script、iframe），要么会触发外部资源加载
 * （img、link、style 里的 url），要么属于表单等交互面，模型输出不需要它们。
 */
const DROP_ENTIRELY = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'img',
  'picture',
  'video',
  'audio',
  'source',
  'track',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'template',
  'noscript',
]);

/** 允许的链接协议。 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return SAFE_PROTOCOLS.has(url.protocol.toLowerCase());
  } catch {
    // 相对地址在扩展面板里没有意义，直接丢弃。
    return false;
  }
}

function rebuildNode(source: Node, targetDocument: Document): Node | null {
  // 文本：原样复制（这是唯一不会被解释为标记的内容）。
  if (source.nodeType === 3 /* TEXT_NODE */) {
    return targetDocument.createTextNode(source.nodeValue ?? '');
  }

  if (source.nodeType !== 1 /* ELEMENT_NODE */) {
    // 注释、处理指令等一律丢弃。
    return null;
  }

  const element = source as Element;
  const tag = element.tagName.toLowerCase();

  if (DROP_ENTIRELY.has(tag)) return null;

  // 未知标签：不保留标签本身，但保留它内部被清洗过的内容。
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = targetDocument.createDocumentFragment();
    for (const child of Array.from(element.childNodes)) {
      const rebuilt = rebuildNode(child, targetDocument);
      if (rebuilt) fragment.appendChild(rebuilt);
    }
    return fragment;
  }

  const clean = targetDocument.createElement(tag);

  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (href !== null && isSafeUrl(href)) {
      clean.setAttribute('href', href);
    }
    const title = element.getAttribute('title');
    if (title !== null) clean.setAttribute('title', title);
  }

  if (tag === 'th' || tag === 'td') {
    const align = element.getAttribute('align');
    if (align === 'left' || align === 'center' || align === 'right') {
      clean.setAttribute('align', align);
    }
  }

  for (const child of Array.from(element.childNodes)) {
    const rebuilt = rebuildNode(child, targetDocument);
    if (rebuilt) clean.appendChild(rebuilt);
  }

  return clean;
}

/**
 * 清洗一段 HTML 字符串，返回仅含白名单内容的新 HTML。
 *
 * 需要在有 DOM 的环境调用（浏览器 / happy-dom）。
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof document === 'undefined') {
    throw new Error('sanitizeHtml 需要浏览器 DOM 环境。');
  }

  // <template> 的内容是惰性的：浏览器不会执行其中的脚本，也不会加载
  // 图片 / iframe 等外部资源。这里刻意不用 DOMParser —— 某些实现
  // （例如 happy-dom）在解析含 iframe 的字符串时会真的去加载页面并抛异常，
  // 既产生噪音，也让解析结果不可靠。
  const template = document.createElement('template');
  template.innerHTML = dirty;

  const output = document.createElement('div');

  for (const child of Array.from(template.content.childNodes)) {
    const rebuilt = rebuildNode(child, document);
    if (rebuilt) output.appendChild(rebuilt);
  }

  return output.innerHTML;
}
