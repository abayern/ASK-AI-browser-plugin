/**
 * 统一的 Result 类型。
 *
 * 业务层不使用异常来表达「用户输入不合法」这类可预期失败，
 * 以免调用方忘记捕获，或把异常信息（可能含敏感上下文）直接抛给 UI。
 */
export interface AppError {
  code: string;
  message: string;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 判断一个未知值是否为普通对象（排除 null 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
