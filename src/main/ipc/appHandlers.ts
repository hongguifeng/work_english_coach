import { app, ipcMain } from 'electron';
import type { Result } from '../../shared/types/app';
import { ok } from '../../shared/types/app';

/**
 * 基础应用 IPC（T002 骨架 / T006 完整实现）
 * 当前仅注册 app:ping 用于验证主进程 <-> 渲染进程链路。
 */
export function registerAppIpc(): void {
  ipcMain.handle('app:ping', (): Result<string> => {
    return ok(`pong: electron=${process.versions.electron} node=${process.versions.node}`);
  });

  ipcMain.handle('app:info', () => {
    return ok({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
    });
  });
}
