/**
 * KeyValueStore 的浏览器实现：基于 WXT 的跨浏览器 storage 封装。
 *
 * 只使用 `storage.local`（`local:` 前缀），因为：
 * - 需求明确要求把 Key 放在 browser.storage.local；
 * - `storage.sync` 会把数据同步到用户云端账户，属于需求禁止的行为。
 *
 * 本文件依赖 WXT 运行时，因此**只应在扩展上下文（background / 设置页）导入**，
 * 单元测试不应导入它（测试使用内存实现）。
 */
import { storage } from 'wxt/utils/storage';

import type { KeyValueStore } from './types';

/** WXT storage 的键名联合类型，形如 `local:xxx`。 */
type LocalStorageKey = `local:${string}`;

function toLocalKey(key: string): LocalStorageKey {
  return `local:${key}`;
}

export function createWxtStorageStore(): KeyValueStore {
  return {
    async get(key: string): Promise<unknown> {
      const value = await storage.getItem<unknown>(toLocalKey(key));
      return value ?? null;
    },

    async set(key: string, value: unknown): Promise<void> {
      // WXT 的 setItem 对值类型有泛型约束，这里的端口刻意使用 unknown，
      // 因此需要一次显式断言；值的实际形状由各仓储在写入前校验。
      await storage.setItem(toLocalKey(key), value as never);
    },

    async remove(key: string): Promise<void> {
      await storage.removeItem(toLocalKey(key));
    },
  };
}
