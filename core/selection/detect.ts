/**
 * 划词检测的纯逻辑。
 *
 * 这些函数刻意不直接读写全局事件与 DOM 状态，只做判断与计算，
 * 因此可以在 happy-dom 里穷举边界：输入框内的选区、空选区、
 * 按钮该出现在上方还是下方、要不要贴边收拢等。
 */
import { LIMITS } from '../shared/limits';

/** 悬浮按钮与选区之间、以及与视口边缘的间距。 */
export const BUTTON_GAP_PX = 8;

/** 选区太短时不打扰用户（单个字符往往是误触）。 */
export const MIN_SELECTION_CHARS = 2;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ButtonSize {
  width: number;
  height: number;
}

export interface ButtonPlacement {
  left: number;
  top: number;
  /** 按钮位于选区上方还是下方，便于必要时调整箭头/动画方向。 */
  placement: 'above' | 'below';
}

/**
 * 判断节点是否处在可编辑上下文里。
 *
 * 在输入框、文本域或 contenteditable 里选中文字时不应该弹按钮——
 * 那是用户在编辑内容，不是想提问。
 */
export function isInEditableContext(node: Node | null): boolean {
  let current: Node | null = node;

  while (current) {
    if (current.nodeType === 1) {
      const element = current as Element;
      const tag = element.tagName.toLowerCase();

      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;

      const contentEditable = element.getAttribute('contenteditable');
      if (contentEditable === '' || contentEditable === 'true') return true;
      if (contentEditable === 'false') return false;

      // 兜底：部分实现提供 isContentEditable 属性。
      const editable = (element as { isContentEditable?: unknown }).isContentEditable;
      if (editable === true) return true;
    }
    current = current.parentNode;
  }

  return false;
}

/**
 * 规范化选中的文字。
 *
 * 只做必要的清理：统一换行、去掉首尾空白。中间内容原样保留——
 * 用户的引用可能包含有意义的缩进与代码片段。
 */
export function normalizeSelectedText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

export interface SelectionCandidate {
  text: string;
  isEditable: boolean;
}

/** 这段选区是否值得弹出按钮。 */
export function isEligibleSelection(candidate: SelectionCandidate): boolean {
  if (candidate.isEditable) return false;

  const text = candidate.text.trim();
  if (text.length < MIN_SELECTION_CHARS) return false;
  if (text.length > LIMITS.selectionMaxChars) return false;

  return true;
}

/**
 * 计算悬浮按钮的位置。
 *
 * 优先放在选区**下方**；下方空间不足时翻到上方。
 * 最终结果会被收拢到视口内，避免在页面边缘被裁掉一半。
 */
export function computeButtonPosition(
  anchor: Rect,
  viewport: ViewportSize,
  button: ButtonSize,
  gap: number = BUTTON_GAP_PX,
): ButtonPlacement {
  const centerX = anchor.left + (anchor.right - anchor.left) / 2;
  const rawLeft = centerX - button.width / 2;

  const aboveTop = anchor.top - button.height - gap;
  const belowTop = anchor.bottom + gap;

  // 默认放在选区**下方**：视线顺着文字往下走，按钮出现在下方更跟手，
  // 也不会挡住刚读完的那一行。只有下方确实放不下时才翻到上方。
  const placement: 'above' | 'below' =
    belowTop + button.height <= viewport.height - gap ? 'below' : 'above';
  const rawTop = placement === 'below' ? belowTop : aboveTop;

  const maxLeft = Math.max(gap, viewport.width - button.width - gap);
  const maxTop = Math.max(gap, viewport.height - button.height - gap);

  return {
    left: Math.min(Math.max(rawLeft, gap), maxLeft),
    top: Math.min(Math.max(rawTop, gap), maxTop),
    placement,
  };
}

/** 选区矩形是否可用（宽高都为 0 通常意味着选区在不可见区域）。 */
export function isUsableRect(rect: Rect): boolean {
  return rect.right - rect.left !== 0 || rect.bottom - rect.top !== 0;
}
