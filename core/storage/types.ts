/**
 * 键值存储端口（port）。
 *
 * 业务逻辑只依赖这个接口，因此：
 * - 测试可以注入内存实现，无需启动浏览器或 WXT 运行时；
 * - 真正接浏览器 storage 的适配器单独放在 wxt-store.ts，
 *   避免把 WXT 依赖传染给纯逻辑与单元测试。
 */
export interface KeyValueStore {
  /** 读取；键不存在时返回 null。 */
  get(key: string): Promise<unknown>;
  /** 写入（覆盖）。 */
  set(key: string, value: unknown): Promise<void>;
  /** 删除；删除不存在的键不应抛错。 */
  remove(key: string): Promise<void>;
}
