// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import {
  BUTTON_GAP_PX,
  MIN_SELECTION_CHARS,
  computeButtonPosition,
  isEligibleSelection,
  isInEditableContext,
  isUsableRect,
  normalizeSelectedText,
} from '../../core/selection/detect';

describe('isInEditableContext', () => {
  it('识别 input / textarea / select', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const element = document.createElement(tag);
      document.body.appendChild(element);
      expect(isInEditableContext(element), tag).toBe(true);
      element.remove();
    }
  });

  it('识别 contenteditable（含空字符串写法）', () => {
    for (const value of ['', 'true']) {
      const element = document.createElement('div');
      element.setAttribute('contenteditable', value);
      expect(isInEditableContext(element), value).toBe(true);
    }
  });

  it('从子节点向上查找可编辑祖先', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    editor.appendChild(span);
    expect(isInEditableContext(span)).toBe(true);
  });

  it('普通段落不算可编辑', () => {
    const p = document.createElement('p');
    p.textContent = 'hello';
    expect(isInEditableContext(p)).toBe(false);
  });

  it('null 安全', () => {
    expect(isInEditableContext(null)).toBe(false);
  });

  it('contenteditable="false" 会终止向上查找', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const readOnly = document.createElement('div');
    readOnly.setAttribute('contenteditable', 'false');
    editor.appendChild(readOnly);
    expect(isInEditableContext(readOnly)).toBe(false);
  });
});

describe('normalizeSelectedText', () => {
  it('去掉首尾空白并统一换行', () => {
    expect(normalizeSelectedText('  a\r\nb  ')).toBe('a\nb');
  });

  it('保留内部缩进与空行', () => {
    expect(normalizeSelectedText('  code\n\n  more')).toBe('code\n\n  more');
  });
});

describe('isEligibleSelection', () => {
  it('普通选区可用', () => {
    expect(isEligibleSelection({ text: '一段文字', isEditable: false })).toBe(true);
  });

  it('可编辑上下文里的选区不可用', () => {
    expect(isEligibleSelection({ text: '一段文字', isEditable: true })).toBe(false);
  });

  it('空选区或纯空白不可用', () => {
    for (const text of ['', '   ', '\n\t']) {
      expect(isEligibleSelection({ text, isEditable: false }), JSON.stringify(text)).toBe(false);
    }
  });

  it('过短的选区不可用（避免误触）', () => {
    expect(MIN_SELECTION_CHARS).toBeGreaterThan(1);
    expect(isEligibleSelection({ text: 'a', isEditable: false })).toBe(false);
  });

  it('超长选区不可用', () => {
    expect(isEligibleSelection({ text: 'a'.repeat(30_000), isEditable: false })).toBe(false);
  });
});

describe('computeButtonPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const button = { width: 96, height: 32 };

  it('默认放在选区下方并水平居中', () => {
    const placement = computeButtonPosition(
      { left: 400, top: 300, right: 500, bottom: 320 },
      viewport,
      button,
    );
    expect(placement.placement).toBe('below');
    expect(placement.top).toBe(320 + BUTTON_GAP_PX);
    expect(placement.left).toBe(450 - 48);
  });

  it('下方空间不足时翻到选区上方', () => {
    // 选区贴近视口底部
    const placement = computeButtonPosition(
      { left: 400, top: 760, right: 500, bottom: 780 },
      viewport,
      button,
    );
    expect(placement.placement).toBe('above');
    expect(placement.top).toBe(760 - 32 - BUTTON_GAP_PX);
  });

  it('选区在页面顶部时仍放在下方（下方空间充足）', () => {
    const placement = computeButtonPosition(
      { left: 400, top: 4, right: 500, bottom: 20 },
      viewport,
      button,
    );
    expect(placement.placement).toBe('below');
    expect(placement.top).toBe(20 + BUTTON_GAP_PX);
  });

  it('贴近左边缘时收拢到视口内', () => {
    const placement = computeButtonPosition(
      { left: 0, top: 300, right: 10, bottom: 320 },
      viewport,
      button,
    );
    expect(placement.left).toBe(BUTTON_GAP_PX);
  });

  it('贴近右边缘时收拢到视口内', () => {
    const placement = computeButtonPosition(
      { left: 990, top: 300, right: 1000, bottom: 320 },
      viewport,
      button,
    );
    expect(placement.left).toBe(viewport.width - button.width - BUTTON_GAP_PX);
  });

  it('结果始终落在视口内', () => {
    const cases = [
      { left: -50, top: -50, right: -10, bottom: -20 },
      { left: 2000, top: 2000, right: 2100, bottom: 2020 },
    ];
    for (const anchor of cases) {
      const placement = computeButtonPosition(anchor, viewport, button);
      expect(placement.left).toBeGreaterThanOrEqual(BUTTON_GAP_PX);
      expect(placement.top).toBeGreaterThanOrEqual(BUTTON_GAP_PX);
      expect(placement.left + button.width).toBeLessThanOrEqual(viewport.width - BUTTON_GAP_PX);
      expect(placement.top + button.height).toBeLessThanOrEqual(viewport.height - BUTTON_GAP_PX);
    }
  });
});

describe('isUsableRect', () => {
  it('零尺寸视为不可用', () => {
    expect(isUsableRect({ left: 10, top: 10, right: 10, bottom: 10 })).toBe(false);
  });

  it('有宽或高即可用', () => {
    expect(isUsableRect({ left: 10, top: 10, right: 20, bottom: 10 })).toBe(true);
    expect(isUsableRect({ left: 10, top: 10, right: 10, bottom: 20 })).toBe(true);
  });
});
