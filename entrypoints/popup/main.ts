/**
 * 工具栏弹窗。
 *
 * 目前它承担两件事：
 * 1. 让用户**显式点击**后在当前标签页注入划词脚本
 *    （点击图标即触发 activeTab 授权，因此不需要申请全站权限）；
 * 2. 保留进入设置页的入口。
 *
 * 刻意用原生 DOM 而不是 React：这个弹窗只有一个按钮和一行状态文本，
 * 引入 React 只会让体积和启动开销变大。
 */
import { browser } from 'wxt/browser';

const enableButton = document.getElementById('enable');
const settingsButton = document.getElementById('settings');
const statusLine = document.getElementById('status');

function setStatus(message: string): void {
  if (statusLine) statusLine.textContent = message;
}

function setBusy(busy: boolean): void {
  if (enableButton instanceof HTMLButtonElement) {
    enableButton.disabled = busy;
  }
}

async function enableOnCurrentTab(): Promise<void> {
  setBusy(true);
  setStatus('正在启用…');

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;

    if (typeof tabId !== 'number') {
      setStatus('找不到当前标签页，请重试。');
      return;
    }

    await browser.scripting.executeScript({
      target: { tabId },
      // 由 WXT 构建出的未列出脚本（不在 manifest 中常驻）
      files: ['selection.js'],
    });

    setStatus('已启用。在本页选中一段文字试试。');
  } catch {
    // 浏览器内置页、应用商店页等禁止注入；不把底层错误抛给用户。
    setStatus('这个页面不允许注入脚本（浏览器内置页或应用商店页面）。');
  } finally {
    setBusy(false);
  }
}

enableButton?.addEventListener('click', () => {
  void enableOnCurrentTab();
});

settingsButton?.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
  window.close();
});
