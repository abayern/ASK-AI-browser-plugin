import { describe, expect, it } from 'vitest';

import {
  PENDING_SELECTION_MAX_CHARS,
  PendingSelectionStore,
} from '../../core/selection/pending';

function createStore() {
  let time = 0;
  const store = new PendingSelectionStore(() => time, 1_000);
  return {
    store,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe('PendingSelectionStore', () => {
  it('按标签页暂存并取回', () => {
    const { store } = createStore();
    store.set(1, '选中文字');
    expect(store.get(1)).toBe('选中文字');
  });

  it('不同标签页互不影响', () => {
    const { store } = createStore();
    store.set(1, '页面一');
    store.set(2, '页面二');
    expect(store.get(1)).toBe('页面一');
    expect(store.get(2)).toBe('页面二');
  });

  it('未暂存过的标签页返回 null', () => {
    const { store } = createStore();
    expect(store.get(99)).toBeNull();
  });

  it('空内容等价于清除，不会留下空字符串', () => {
    const { store } = createStore();
    store.set(1, '有内容');
    store.set(1, '   ');
    expect(store.get(1)).toBeNull();
  });

  it('超过 TTL 后自动失效', () => {
    const { store, advance } = createStore();
    store.set(1, '会过期');
    advance(999);
    expect(store.get(1)).toBe('会过期');
    advance(2);
    expect(store.get(1)).toBeNull();
  });

  it('过期项在下次读取时被真正删除，不会占内存', () => {
    const { store, advance } = createStore();
    store.set(1, 'x');
    advance(5_000);
    expect(store.get(1)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('超长选区被截断', () => {
    const { store } = createStore();
    store.set(1, 'a'.repeat(PENDING_SELECTION_MAX_CHARS + 1_000));
    expect(store.get(1)?.length).toBe(PENDING_SELECTION_MAX_CHARS);
  });

  it('前后空白被裁掉', () => {
    const { store } = createStore();
    store.set(1, '  hello  ');
    expect(store.get(1)).toBe('hello');
  });

  it('clear 立即移除', () => {
    const { store } = createStore();
    store.set(1, 'x');
    store.clear(1);
    expect(store.get(1)).toBeNull();
  });

  it('prune 清掉全部过期项但保留有效的', () => {
    const { store, advance } = createStore();
    store.set(1, 'old');
    advance(800);
    store.set(2, 'fresh');
    advance(400);

    store.prune();

    expect(store.get(1)).toBeNull();
    expect(store.get(2)).toBe('fresh');
  });
});
