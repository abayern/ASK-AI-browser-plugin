/**
 * 把模型返回的 Markdown 渲染为**可安全插入 DOM** 的 HTML。
 *
 * 安全边界是 `sanitizeHtml`（见 sanitize.ts），它解析后**重建**节点树：
 * - 排版标签走白名单，未知标签只保留其清洗后的文本内容；
 * - script / iframe / object / img / style 等连同内容整段丢弃
 *   （它们能执行代码或触发外部资源加载）；
 * - 链接协议只允许 http / https / mailto。
 *
 * 这里**刻意不关闭** marked 的原始 HTML 处理：不少模型会输出 `<br>`、
 * `<details>` 之类无害标签，直接转义会让回答变成一堆可见的尖括号。
 * 真正的安全由消毒器保证——它不依赖 marked 是否转义，因此这条路径
 * 无论 markdown 里出现什么都不会产生可执行内容。
 *
 * 曾尝试用 DOMPurify，但在本项目的构建/测试链里出现「同样配置、不同输入、
 * 白名单与黑名单行为颠倒」的不确定表现，故改用行为完全可控的实现。
 */
import { marked } from 'marked';

import { sanitizeHtml } from './sanitize';

/**
 * 渲染并清洗。
 *
 * 返回值已包含消毒步骤，调用方可以直接插入 DOM。
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, {
    gfm: true,
    breaks: true,
    async: false,
  }) as string;

  return sanitizeHtml(rawHtml);
}
