import type { KeyValueStore } from '../../core/storage/types';

/**
 * 测试用的内存版 KeyValueStore。
 *
 * 有了这个实现，纯业务逻辑的测试不需要浏览器、不需要 WXT 运行时，
 * 也能覆盖「存储内容被篡改」这类异常路径。
 */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.data.set(key, value);
      }
    }
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.has(key) ? this.data.get(key) : null);
  }

  set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

/** 一个总是抛错的存储，用于验证「读取失败时按未配置处理」。 */
export class ThrowingStore implements KeyValueStore {
  get(): Promise<unknown> {
    return Promise.reject(new Error('storage unavailable'));
  }

  set(): Promise<void> {
    return Promise.reject(new Error('storage unavailable'));
  }

  remove(): Promise<void> {
    return Promise.reject(new Error('storage unavailable'));
  }
}
