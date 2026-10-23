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
  // 扩展重新加载 / 更新后，页面里已注入的旧实例仍然挂在 DOM 上，
  // 但它的 browser.runtime 上下文已经失效，点按钮必然失败。
  // 这里不能「发现已存在就直接 return」——那样用户再点「在本页启用」
  // 也救不回来，只能刷新页面。改为移除旧宿主，让新实例接管。
  document.getElementById(HOST_ID)?.remove();

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

  // 用样式表而不是内联 style：hover、过渡、键盘焦点环这些伪类与状态
  // 在内联样式里写不出来，维护起来也更糟。
  const style = document.createElement('style');
  style.textContent = `
    /* ---- 划词工具栏 ---- */

    .ask-bar {
      position: fixed;
      display: none;
      align-items: center;
      gap: 2px;
      height: ${BUTTON_HEIGHT}px;
      padding: 0 6px 0 4px;
      border: 1px solid #e4e3de;
      border-radius: 10px;
      background: #ffffff;
      color: #15181c;
      font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 12.5px;
      line-height: 1;
      white-space: nowrap;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(15, 18, 22, 0.16), 0 1px 3px rgba(15, 18, 22, 0.1);
    }

    /* 拖动手柄：按住可以移动整条工具栏 */
    .ask-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 24px;
      border-radius: 5px;
      color: #b6b2a8;
      cursor: grab;
      touch-action: none;
      flex: none;
    }

    .ask-handle:hover {
      color: #69645c;
      background: #f2f1ec;
    }

    .ask-handle:active {
      cursor: grabbing;
    }

    .ask-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #2b6cb0;
      flex: none;
    }

    /* 用 CSS 画一个菱形标记，避免引入图片资源 */
    .ask-logo::after {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: #ffffff;
      transform: rotate(45deg);
    }

    .ask-divider {
      width: 1px;
      height: 16px;
      margin: 0 4px;
      background: #e4e3de;
      flex: none;
    }

    .ask-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .ask-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 26px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #3a382f;
      font: inherit;
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    .ask-action:hover {
      background: #f2f1ec;
    }

    .ask-action:active {
      background: #e9e7e0;
    }

    .ask-action:focus-visible {
      outline: 2px solid #2b6cb0;
      outline-offset: 1px;
    }

    .ask-action svg {
      flex: none;
    }

    /* 出错或已复制时的短暂提示，占用同一条工具栏 */
    .ask-status {
      display: none;
      padding: 0 10px;
      color: #69645c;
      font-size: 12.5px;
    }

    /* ---- 面板容器 ---- */

    .ask-panel {
      display: flex;
      flex-direction: column;
      border-radius: 10px;
      background: #fafaf8;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(15, 18, 22, 0.28);
    }

    /* 拖动过程中避免顺手选中面板外的网页文字 */
    .ask-panel--dragging {
      user-select: none;
    }

    /*
     * 顶部拖动手柄。
     * 为什么由页面侧渲染：面板内容在 iframe 里，iframe 内的指针事件
     * 不会传给父页面，因此「拖动整窗」只能由页面侧接收指针来驱动。
     */
    .ask-grip {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 16px;
      background: #fafaf8;
      border-bottom: 1px solid #e4e3de;
      cursor: grab;
      touch-action: none;
      pointer-events: auto;
    }

    .ask-grip:active {
      cursor: grabbing;
    }

    .ask-grip__pill {
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: #d8d6cf;
    }

    .ask-frame {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      display: block;
      border: 0;
      background: #fafaf8;
      color-scheme: light;
    }

    /* 收起后贴在右侧的小标签：点它可以把面板展开回来 */
    .ask-chip {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 46px;
      border: 0;
      border-radius: 8px 0 0 8px;
      background: #15181c;
      color: #fafaf8;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: -2px 0 14px rgba(15, 18, 22, 0.26);
      transition: background-color 120ms ease;
    }

    .ask-chip:hover {
      background: #0b0e11;
    }

    .ask-chip:focus-visible {
      outline: 2px solid #8ab4f8;
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .ask-action {
        transition: none;
      }
    }
  `;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function createIcon(paths: string[]): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  /** 左侧六点拖动手柄（用 SVG 画，避免字体渲染差异）。 */
  function createGripDots(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const points = [
      [9, 7],
      [15, 7],
      [9, 12],
      [15, 12],
      [9, 17],
      [15, 17],
    ];

    for (const [cx, cy] of points) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '1.5');
      svg.appendChild(dot);
    }
    return svg;
  }

  const bar = document.createElement('div');
  bar.className = 'ask-bar';

  const handle = document.createElement('div');
  handle.className = 'ask-handle';
  handle.title = '拖动移动工具栏';
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', '拖动移动工具栏');
  handle.appendChild(createGripDots());

  const logo = document.createElement('span');
  logo.className = 'ask-logo';
  logo.setAttribute('aria-hidden', 'true');

  const divider = document.createElement('span');
  divider.className = 'ask-divider';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'ask-actions';

  const statusEl = document.createElement('span');
  statusEl.className = 'ask-status';

  function createAction(
    labelText: string,
    icon: SVGSVGElement,
    onActivate: () => void,
  ): HTMLButtonElement {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'ask-action';
    actionButton.appendChild(icon);

    const text = document.createElement('span');
    text.textContent = labelText;
    actionButton.appendChild(text);

    // 按下时阻止页面逻辑把工具栏收起，否则点击还没完成就被隐藏了。
    actionButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    actionButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    });

    return actionButton;
  }

  const askAction = createAction(
    '问问 AI',
    createIcon(['M12 3.5l1.9 4.9 4.6 1.6-4.6 1.6L12 16.5l-1.9-4.9L5.5 10l4.6-1.6z']),
    () => {
      void openSelectionPanel(null);
    },
  );

  const translateAction = createAction(
    '翻译',
    createIcon([
      'M12 3a9 9 0 100 18 9 9 0 000-18z',
      'M3 12h18',
      'M12 3c2.4 2.6 2.4 15.4 0 18',
      'M12 3c-2.4 2.6-2.4 15.4 0 18',
    ]),
    () => {
      void openSelectionPanel('translate');
    },
  );

  const copyAction = createAction(
    '复制',
    createIcon([
      'M8.5 8.5h9A1.5 1.5 0 0119 10v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 017 19v-9a1.5 1.5 0 011.5-1.5z',
      'M6 15.5H5A1.5 1.5 0 013.5 14V5A1.5 1.5 0 015 3.5h9A1.5 1.5 0 0115.5 5v1',
    ]),
    () => {
      void copySelectedText();
    },
  );

  actionsRow.append(askAction, translateAction, copyAction);
  bar.append(handle, logo, divider, actionsRow, statusEl);

  shadow.append(style, bar);
  document.documentElement.appendChild(host);

  // ---- 状态 ----
  let currentText = '';
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最近一次弹出工具栏时的选区水平范围，用于决定面板落在哪一侧。 */
  let lastAnchorRect: { left: number; right: number } | null = null;

  /** 用一条状态提示暂时替换动作按钮（已复制 / 打开失败 等）。 */
  function flashStatus(message: string): void {
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    actionsRow.style.display = 'none';

    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.style.display = 'none';
      actionsRow.style.display = 'flex';
      statusTimer = null;
    }, 1600);
  }

  function resetActions(): void {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    statusEl.style.display = 'none';
    actionsRow.style.display = 'flex';
  }

  function hide(): void {
    bar.style.display = 'none';
    currentText = '';
  }

  function show(text: string, anchorRect: DOMRect): void {
    currentText = text;
    lastAnchorRect = { left: anchorRect.left, right: anchorRect.right };

    // 上一次可能停在「已复制」之类的提示态，这里复原动作按钮。
    resetActions();

    // 先显示出来才能量到真实尺寸；字体、语言、缩放都会影响宽度，
    // 用实测值定位比写死常量更稳，否则工具栏不会真正居中。
    bar.style.display = 'flex';
    const measured = bar.getBoundingClientRect();

    const placement = computeButtonPosition(
      {
        left: anchorRect.left,
        top: anchorRect.top,
        right: anchorRect.right,
        bottom: anchorRect.bottom,
      },
      { width: window.innerWidth, height: window.innerHeight },
      {
        width: measured.width > 0 ? measured.width : BUTTON_WIDTH,
        height: measured.height > 0 ? measured.height : BUTTON_HEIGHT,
      },
    );

    bar.style.left = `${placement.left}px`;
    bar.style.top = `${placement.top}px`;
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

  // ---- 动作 ----

  /**
   * 打开面板。`preset` 为快捷动作（目前只有翻译），
   * 面板拿到后会据此自动发起一次提问。
   */
  async function openSelectionPanel(preset: 'translate' | null): Promise<void> {
    const text = currentText;
    const anchor = lastAnchorRect;
    if (text === '') return;

    // 先把选区交给后台暂存，面板随后按 tabId 取回。
    // 不把正文塞进 iframe URL，避免网页内容出现在地址栏或历史记录里。
    try {
      const response: unknown = await browser.runtime.sendMessage({
        type: 'selection/set',
        payload: { text, ...(preset === null ? {} : { preset }) },
      });

      // 先尝试打开面板，成功后才收起工具栏：
      // 若 openPanel 抛错，至少工具栏还在，可以把失败显示出来，
      // 而不是「点了完全没反应」。
      openPanel({ anchor, pushContent: readPushPreference(response) });
      hide();
    } catch (error: unknown) {
      // 扩展被重新加载/更新后，旧页面里的脚本会失去上下文，
      // 这时必须让用户刷新页面才可能恢复——不要只说一句含糊的「失败」。
      const message = error instanceof Error ? error.message : String(error);
      flashStatus(
        /context invalidated|receiving end does not exist/i.test(message)
          ? '请刷新本页'
          : '打开失败',
      );
    }
  }

  /** 复制选中文字，不调用模型。 */
  async function copySelectedText(): Promise<void> {
    const text = currentText;
    if (text === '') return;

    try {
      await navigator.clipboard.writeText(text);
      flashStatus('已复制');
      return;
    } catch {
      // 部分站点/权限状态下 clipboard API 不可用，退回旧办法。
    }

    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
      flashStatus('已复制');
    } catch {
      flashStatus('复制失败');
    }
  }

  // ---- 拖动工具栏 ----

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = bar.getBoundingClientRect();
    // 拖动期间统一用 left/top，避免与初始定位方式混用导致跳位。
    bar.style.left = `${rect.left}px`;
    bar.style.top = `${rect.top}px`;
    bar.style.display = 'flex';

    handle.setPointerCapture(event.pointerId);

    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const onMove = (moveEvent: PointerEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      bar.style.left = `${Math.min(Math.max(moveEvent.clientX - offsetX, 0), maxLeft)}px`;
      bar.style.top = `${Math.min(Math.max(moveEvent.clientY - offsetY, 0), maxTop)}px`;
    };

    const finish = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });

  /** 从 selection/set 的响应里取出面板停靠方式。 */
  function readPushPreference(response: unknown): boolean {
    if (typeof response !== 'object' || response === null) return false;
    const envelope = response as { ok?: unknown; data?: unknown };
    if (envelope.ok !== true) return false;
    const data = envelope.data as { pushPanelContent?: unknown } | null | undefined;
    return data?.pushPanelContent === true;
  }

  // ---- 面板 ----

  const PANEL_WIDTH = 400;
  const PANEL_MARGIN = 16;
  /** 挤压式停靠时给页面让出的宽度。 */
  const PUSH_WIDTH = PANEL_WIDTH + PANEL_MARGIN * 2;

  let panelFrame: HTMLIFrameElement | null = null;
  let panelWrap: HTMLDivElement | null = null;
  let restoreChip: HTMLButtonElement | null = null;
  /** 本次打开是否使用挤压式停靠。 */
  let pushRequested = false;
  /** 挤压前 html 原本的 margin-right；null 表示当前没有挤压。 */
  let previousMarginRight: string | null = null;

  /**
   * 让页面为面板让出空间。
   *
   * 只改 `html` 的 margin-right：这是改动最小、可逆的做法。
   * 注意它无法移动 `position: fixed` 的元素（导航栏、挂件），
   * 这类站点仍可能被盖住——所以这个开关默认关闭。
   */
  function applyPush(enabled: boolean): void {
    const root = document.documentElement;

    if (enabled) {
      if (previousMarginRight === null) previousMarginRight = root.style.marginRight;
      root.style.marginRight = `${PUSH_WIDTH}px`;
      return;
    }

    if (previousMarginRight !== null) {
      root.style.marginRight = previousMarginRight;
      previousMarginRight = null;
    }
  }

  /** 浮层模式下，面板落在选区的对侧，尽量不挡住正在读的地方。 */
  function pickSide(anchor: { left: number; right: number } | null): 'left' | 'right' {
    if (!anchor) return 'right';
    const center = (anchor.left + anchor.right) / 2;
    return center > window.innerWidth / 2 ? 'left' : 'right';
  }

  /** 拖动后的位置；null 表示还没被拖动过，按对侧规则落位。 */
  let panelPosition: { left: number; top: number } | null = null;

  function openPanel(options: {
    anchor: { left: number; right: number } | null;
    pushContent: boolean;
  }): void {
    // 已经打开：从折叠态恢复，或把焦点给它。
    if (panelFrame) {
      expandPanel();
      return;
    }

    // 挤压式只让出右侧空间，因此必须停靠右侧；
    // 浮层则避开选区所在的一侧。
    const side = options.pushContent ? 'right' : pickSide(options.anchor);
    pushRequested = options.pushContent;

    // 挤压式是固定停靠，不需要拖动；只有浮层模式装拖动手柄。
    const draggable = !options.pushContent;

    const wrap = document.createElement('div');
    wrap.className = draggable ? 'ask-panel' : 'ask-panel ask-panel--docked';
    wrap.setAttribute(
      'style',
      [
        'position: fixed',
        `width: ${PANEL_WIDTH}px`,
        'max-width: calc(100vw - 32px)',
        'height: min(660px, calc(100vh - 32px))',
        'pointer-events: auto',
      ].join(';'),
    );

    if (draggable) {
      const grip = document.createElement('div');
      grip.className = 'ask-grip';
      grip.title = '拖动调整位置';
      grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', '拖动调整面板位置');

      const pill = document.createElement('span');
      pill.className = 'ask-grip__pill';
      grip.appendChild(pill);

      grip.addEventListener('pointerdown', startDrag);
      wrap.appendChild(grip);
    }

    const frame = document.createElement('iframe');
    frame.className = 'ask-frame';
    // 面板是本扩展的页面：与网页跨域隔离，网页脚本读不到面板内容。
    // WXT 的 runtime 类型把 getURL 收窄成了仅接受已声明的 public 路径，
    // 这里需要运行时的真实行为，因此做一次显式断言。
    const runtimeWithUrl = browser.runtime as unknown as { getURL(path: string): string };
    frame.src = runtimeWithUrl.getURL('/panel.html');
    frame.title = '划词问 AI';

    wrap.appendChild(frame);

    // 位置：拖动过就沿用上次位置；否则贴在选区对侧。
    if (draggable && panelPosition) {
      wrap.style.left = `${panelPosition.left}px`;
      wrap.style.top = `${panelPosition.top}px`;
    } else {
      wrap.style.top = `${PANEL_MARGIN}px`;
      if (side === 'right') {
        wrap.style.right = `${PANEL_MARGIN}px`;
      } else {
        wrap.style.left = `${PANEL_MARGIN}px`;
      }
    }

    shadow.appendChild(wrap);

    panelWrap = wrap;
    panelFrame = frame;

    applyPush(options.pushContent);
  }

  /**
   * 按住顶部手柄拖动整窗。
   *
   * 指针捕获必须设在**页面侧**的手柄上：iframe 内部的指针事件不会冒泡
   * 到父页面，所以拖动只能由页面侧驱动。
   */
  function startDrag(event: PointerEvent): void {
    const wrap = panelWrap;
    const grip = event.currentTarget;
    if (!wrap || !(grip instanceof HTMLElement)) return;

    event.preventDefault();

    const rect = wrap.getBoundingClientRect();

    // 拖动期间统一用 left/top 定位，避免 right 与 left 同时存在导致跳位。
    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.right = 'auto';
    wrap.classList.add('ask-panel--dragging');

    grip.setPointerCapture(event.pointerId);

    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const onMove = (moveEvent: PointerEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      const left = Math.min(Math.max(moveEvent.clientX - offsetX, 0), maxLeft);
      const top = Math.min(Math.max(moveEvent.clientY - offsetY, 0), maxTop);

      // 始终完整留在视口内，避免被拖到屏幕外再也抓不回来。
      wrap.style.left = `${left}px`;
      wrap.style.top = `${top}px`;
    };

    const finish = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', finish);
      grip.removeEventListener('pointercancel', finish);
      wrap.classList.remove('ask-panel--dragging');

      const current = wrap.getBoundingClientRect();
      panelPosition = { left: current.left, top: current.top };
    };

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
  }

  /** 收起为侧边小标签，把网页让出来。 */
  function collapsePanel(): void {
    if (!panelWrap) return;

    panelWrap.style.display = 'none';
    applyPush(false);
    showChip();
    panelFrame?.focus();
  }

  function expandPanel(): void {
    if (!panelWrap) return;

    // 置空而不是 'block'：容器是靠 CSS 类做 flex 纵向布局的，
    // 写成 block 会让 iframe 失去高度。
    panelWrap.style.display = '';
    hideChip();
    applyPush(pushRequested);
    panelFrame?.focus();
  }

  function showChip(): void {
    if (restoreChip) {
      restoreChip.style.display = 'flex';
      return;
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ask-chip';
    chip.textContent = 'AI';
    chip.title = '展开划词问 AI';
    chip.setAttribute('aria-label', '展开划词问 AI');
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandPanel();
    });

    shadow.appendChild(chip);
    restoreChip = chip;
  }

  function hideChip(): void {
    restoreChip?.remove();
    restoreChip = null;
  }

  function closePanel(): void {
    panelWrap?.remove();
    panelWrap = null;
    panelFrame = null;
    hideChip();
    applyPush(false);
  }

  // 面板内的「×」「收起」与 Esc 通过 postMessage 请求。
  // 只接受来自我们自己那个 iframe 的消息：网页无法伪造 event.source。
  window.addEventListener('message', (event) => {
    if (!panelFrame || event.source !== panelFrame.contentWindow) return;

    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) return;

    const type = (data as { type?: unknown }).type;
    if (type === 'ask-ai-panel/close') {
      closePanel();
    } else if (type === 'ask-ai-panel/collapse') {
      collapsePanel();
    }
  });

  // 视口变小后，已拖出边界的面板要拉回来，否则会有一半在屏幕外。
  window.addEventListener('resize', () => {
    if (!panelWrap || !panelPosition) return;

    const rect = panelWrap.getBoundingClientRect();
    const left = Math.min(panelPosition.left, Math.max(0, window.innerWidth - rect.width));
    const top = Math.min(panelPosition.top, Math.max(0, window.innerHeight - rect.height));

    panelPosition = { left, top };
    panelWrap.style.left = `${left}px`;
    panelWrap.style.top = `${top}px`;
    panelWrap.style.right = 'auto';
  });
});
