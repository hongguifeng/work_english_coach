import { err, ok } from '../../shared/types/app';
import type { AppError, Result } from '../../shared/types/app';

/**
 * 把底层错误（驱动 / OS / 网络等）归类为统一的 AppError（带 ErrorCode）。
 *
 * 原则（docs/02 §5、docs/06 §3）：
 * - `code` 是稳定的机器可读码（'storage' | 'validation' | 'network' | 'timeout' | 'parse' | 'config' | 'unknown'）；
 * - `message` 是面向用户的中文文案（不含 SQL / 堆栈）；
 * - `debug` 是开发用细节（原始错误信息），仅本地日志可见，不展示给用户。
 */
export function classifyError(error: unknown): AppError {
  const isErr = error instanceof Error;
  const msg = isErr ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  const name = isErr ? error.name : '';
  const lower = msg.toLowerCase();

  // SQLite 约束 / 结构错误 → storage
  if (
    lower.includes('unique constraint') ||
    lower.includes('not null') ||
    lower.includes('foreign key') ||
    lower.includes('no such table') ||
    lower.includes('no such column') ||
    lower.includes('sqlite') ||
    name === 'SqliteError'
  ) {
    return { code: 'storage', message: '数据存储操作失败', debug: msg };
  }

  // 超时
  if (name === 'TimeoutError' || lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return { code: 'timeout', message: '操作超时，请重试', debug: msg };
  }

  // 网络
  if (
    name === 'FetchError' ||
    name === 'ECONNREFUSED' ||
    name === 'ECONNRESET' ||
    lower.includes('network') ||
    lower.includes('econn') ||
    lower.includes('fetch failed')
  ) {
    return { code: 'network', message: '网络连接失败，请检查网络后重试', debug: msg };
  }

  // 解析 / 校验
  if (lower.includes('invalid json') || lower.includes('parse') || name === 'SyntaxError') {
    return { code: 'parse', message: '数据格式错误', debug: msg };
  }

  return { code: 'unknown', message: '发生未知错误，请重试', debug: msg };
}

/** 把同步函数执行包装为 Result：成功 → ok，失败 → classifyError 归类（message 面向用户、debug 留原始信息）。 */
export function toResult<T>(run: () => T): Result<T> {
  try {
    return ok(run());
  } catch (error) {
    const a = classifyError(error);
    return err(a.code, a.message, a.debug);
  }
}
