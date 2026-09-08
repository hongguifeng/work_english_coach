import { ipcRenderer } from 'electron';
import type { Result } from '../shared/types/app';

/**
 * 受控的 IPC 调用封装（T004 / T012）
 * - 只允许调用白名单渠道（由各 api 模块显式调用，不暴露原始 ipcRenderer）
 * - 统一返回 Result<T> 结构
 */
export function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>;
}
