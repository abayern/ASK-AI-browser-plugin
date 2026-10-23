/**
 * 待处理选区暂存。
 *
 * 为什么需要它：Content Script 拿到选中文字后，需要把它交给**扩展 origin
 * 的 iframe 面板**。若通过 iframe URL 传参，网页正文就会出现在 URL 里
 * （可能被历史记录、日志、截图带出），所以改由后台做一次中转：
 *
 *   Content Script --selection/set--> background（按 tabId 暂存）
 *   panel（扩展页） --panel/getSelection--> background（按 sender.tab.id 取回）
 *
 * 附带收益：暂存有 TTL，用户很久之后才打开面板不会拿到过期的旧内容。
 */

export interface PendingSelection {
  text: string;
  /** 快捷动作预设（例如翻译）；面板据此自动发起一次提问。 */
  preset: string | null;
  updatedAt: number;
}

export const PENDING_SELECTION_TTL_MS = 5 * 60 * 1000;
export const PENDING_SELECTION_MAX_CHARS = 20_000;

export class PendingSelectionStore {
  private readonly entries = new Map<number, PendingSelection>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(now: () => number = () => Date.now(), ttlMs: number = PENDING_SELECTION_TTL_MS) {
    this.now = now;
    this.ttlMs = ttlMs;
  }

  /** 暂存某个标签页的最新选区；空内容等价于清除。 */
  set(tabId: number, text: string, preset: string | null = null): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      this.entries.delete(tabId);
      return;
    }
    this.entries.set(tabId, {
      text: trimmed.slice(0, PENDING_SELECTION_MAX_CHARS),
      preset,
      updatedAt: this.now(),
    });
  }

  /** 取回未过期的选区；过期或不存在返回 null。 */
  get(tabId: number): string | null {
    return this.readEntry(tabId)?.text ?? null;
  }

  /** 取回本次选区的快捷动作预设；没有则返回 null。 */
  getPreset(tabId: number): string | null {
    return this.readEntry(tabId)?.preset ?? null;
  }

  private readEntry(tabId: number): PendingSelection | null {
    const entry = this.entries.get(tabId);
    if (!entry) return null;

    if (this.now() - entry.updatedAt > this.ttlMs) {
      this.entries.delete(tabId);
      return null;
    }
    return entry;
  }

  clear(tabId: number): void {
    this.entries.delete(tabId);
  }

  /** 清掉所有过期项，避免长期驻留。 */
  prune(): void {
    const threshold = this.now() - this.ttlMs;
    for (const [tabId, entry] of this.entries) {
      if (entry.updatedAt < threshold) this.entries.delete(tabId);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
