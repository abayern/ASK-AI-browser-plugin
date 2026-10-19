import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

import {
  computeButtonPosition,
  isEligibleSelection,
  isInEditableContext,
  isUsableRect,
  normalizeSelectedText,
} from '../core/selection/detect';

/** 宿主节点 id，用于幂等判断：重复注入时直接退出。 */
const HOST_ID = 'ask-ai-selection-host';

/** 按钮尺寸（与 shadow 内样式保持一致）。 */
const BUTTON_WIDTH = 104;
const BUTTON_HEIGHT = 34;

/**
 * 划词悬浮按钮。
 *
 * 通过 `scripting.executeScript` 注入（见 popup），因此本文件不使用
 * `defineContentScript`：它不写进 manifest，不在所有页面常驻。
 *
 * 隔离性：
 * - UI 全部放在 Shadow DOM 内，网页的 CSS 影响不到它，它也污染不了网页；
 * - 宿主节点 `pointer-events: none`，只有按钮本身接收事件，不会挡住页面交互；
 * - 不修改网页任何既有节点，只追加自己的一层。
 */
export default defineUnlistedScript(() => {
  if (document.getElementById(HOST_ID)) return;

  // ---- UI ----
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'width: 0',
    'height: 0',
    'z-index: 2147483647',
    'pointer-events: none',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '问问 AI';
  button.setAttribute(
    'style',
    [
      'position: fixed',
      'display: none',
      'align-items: center',
      'gap: 6px',
      'height: 34px',
      'padding: 0 14px',
      'border: 1px solid #2b6cb0',
      'border-radius: 4px',
      'background: #2b6cb0',
      'color: #fff',
      'font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'line-height: 1',
      'cursor: pointer',
      'pointer-events: auto',
      'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18)',
      'transition: background-color 120ms ease, opacity 120ms ease',
    ].join(';'),
  );

  shadow.appendChild(button);
  document.documentElement.appendChild(host);

  // ---- 状态 ----
  let currentText = '';
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function hide(): void {
    button.style.display = 'none';
    currentText = '';
  }

  function show(text: string, anchorRect: DOMRect): void {
    currentText = text;
    const placement = computeButtonPosition(
      { left: anchorRect.left, top: anchorRect.top, right: anchorRect.right, bottom: anchorRect.bottom },
      { width: window.innerWidth, height: window.innerHeight },
      { width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
    );

    button.style.left = `${placement.left}px`;
    button.style.top = `${placement.top}px`;
    button.style.display = 'flex';
    button.textContent = '问问 AI';
  }

  /** 读取当前选区；不满足条件时返回 null。 */
  function readSelection(): { text: string; rect: DOMRect } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const text = normalizeSelectedText(selection.toString());
    const anchorNode = selection.anchorNode;

    if (!isEligibleSelection({ text, isEditable: isInEditableContext(anchorNode) })) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!isUsableRect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })) {
      return null;
    }

    return { text, rect };
  }

  function syncFromSelection(): void {
    // 鼠标刚松开时浏览器可能还没更新选区，放到下一个任务里读。
    setTimeout(() => {
      const found = readSelection();
      if (found) {
        show(found.text, found.rect);
      } else {
        hide();
      }
    }, 0);
  }

  // ---- 事件 ----

  // 用捕获阶段，避免网页 stopPropagation 把事件吃掉。
  document.addEventListener(
    'mouseup',
    (event) => {
      const target = event.target;
      if (target instanceof Node && host.contains(target)) return;
      syncFromSelection();
    },
    true,
  );

  // 键盘选择（Shift+方向键）与拖拽选择都会触发 selectionchange。
  document.addEventListener(
    'selectionchange',
    () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const found = readSelection();
        if (found) show(found.text, found.rect);
        else hide();
      }, 200);
    },
    true,
  );

  // 页面滚动或窗口尺寸变化后按钮位置会失效，直接收起。
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  document.addEventListener(
    'mousedown',
    (event) => {
      const target = event.target;
      if (target instanceof Node && host.contains(target)) return;
      hide();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') hide();
    },
    true,
  );

  // ---- 点击 ----
  button.addEventListener('mousedown', (event) => {
    // 防止按下时被上面的 mousedown 处理器收起
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const text = currentText;
    if (text === '') return;

    // 先把选区交给后台暂存，面板随后按 tabId 取回。
    // 不把正文塞进 iframe URL，避免网页内容出现在地址栏或历史记录里。
    void browser.runtime
      .sendMessage({ type: 'selection/set', payload: { text } })
      .then(() => {
        hide();
        openPanel();
      })
      .catch(() => {
        button.textContent = '未能记录';
        setTimeout(() => {
          hide();
        }, 1200);
      });
  });

  // ---- 面板 ----

  let panelFrame: HTMLIFrameElement | null = null;
  let panelWrap: HTMLDivElement | null = null;

  function openPanel(): void {
    // 已经打开时不重复注入。
    if (panelFrame) {
      panelFrame.focus();
      return;
    }

    const wrap = document.createElement('div');
    wrap.setAttribute(
      'style',
      [
        'position: fixed',
        'top: 16px',
        'right: 16px',
        'width: 400px',
        'max-width: calc(100vw - 32px)',
        'height: min(660px, calc(100vh - 32px))',
        'pointer-events: auto',
      ].join(';'),
    );

    const frame = document.createElement('iframe');
    // 面板是本扩展的页面：与网页跨域隔离，网页脚本读不到面板内容。
    // WXT 的 runtime 类型把 getURL 收窄成了仅接受已声明的 public 路径，
    // 这里需要运行时的真实行为，因此做一次显式断言。
    const runtimeWithUrl = browser.runtime as unknown as { getURL(path: string): string };
    frame.src = runtimeWithUrl.getURL('/panel.html');
    frame.title = '划词问 AI';
    frame.setAttribute(
      'style',
      [
        'width: 100%',
        'height: 100%',
        'border: 0',
        'border-radius: 10px',
        'background: #fafaf8',
        'color-scheme: light',
        'box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28)',
      ].join(';'),
    );

    wrap.appendChild(frame);
    shadow.appendChild(wrap);

    panelWrap = wrap;
    panelFrame = frame;
  }

  function closePanel(): void {
    panelWrap?.remove();
    panelWrap = null;
    panelFrame = null;
  }

  // 面板内的「×」与 Esc 通过 postMessage 请求收起。
  // 只接受来自我们自己那个 iframe 的消息：网页无法伪造 event.source。
  window.addEventListener('message', (event) => {
    if (!panelFrame || event.source !== panelFrame.contentWindow) return;

    const data: unknown = event.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === 'ask-ai-panel/close'
    ) {
      closePanel();
    }
  });
});
