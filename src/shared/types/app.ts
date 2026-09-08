/**
 * 共享基础类型（主进程 / 渲染进程 / Preload 通用）
 *
 * 规则（docs/06）：
 * - IPC 一律返回 Result<T>，错误信息只包含用户可读的 description
 * - 错误分类：validation | network | parse | storage | unknown
 */

export type ErrorCode =
  | 'validation'
  | 'network'
  | 'timeout'
  | 'parse'
  | 'storage'
  | 'config'
  | 'unknown';

export interface AppError {
  code: ErrorCode;
  /** 用户可读的错误描述（不含 API Key、原始堆栈等敏感信息） */
  message: string;
  /** 可选的调试信息（仅写入本地日志，不展示给渲染进程） */
  debug?: string;
}

export interface OkResult<T> {
  ok: true;
  data: T;
}

export interface ErrResult {
  ok: false;
  error: AppError;
}

export type Result<T> = OkResult<T> | ErrResult;

export function ok<T>(data: T): OkResult<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message: string, debug?: string): ErrResult {
  return { ok: false, error: { code, message, ...(debug !== undefined ? { debug } : {}) } };
}
