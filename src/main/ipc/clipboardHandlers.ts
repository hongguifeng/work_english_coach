import { ipcMain } from 'electron';
import { err, type Result } from '../../shared/types/app';
import { devLog } from '../log';
import {
  getSharedClipboardBackend,
  readClipboardText,
  writeClipboardText,
} from '../services/clipboardService';

/**
 * 注册剪贴板相关 IPC（T024）。
 * - clipboard:write：把指定文本写入系统剪贴板（参数做 Zod 校验）。
 * - clipboard:read：读取系统剪贴板文本（剪贴板为空时返回空字符串）。
 */
export function registerClipboardIpc(): void {
  ipcMain.handle('clipboard:write', async (_event, payload: unknown): Promise<Result<boolean>> => {
    try {
      if (typeof payload !== 'string' || payload.length === 0) {
        return err('validation', '复制内容不能为空');
      }
      const backend = await getSharedClipboardBackend();
      return writeClipboardText(backend, payload);
    } catch (e) {
      devLog('clipboard:write error:', e);
      return err('storage', '复制到剪贴板失败');
    }
  });

  ipcMain.handle('clipboard:read', async (): Promise<Result<string>> => {
    try {
      const backend = await getSharedClipboardBackend();
      return readClipboardText(backend);
    } catch (e) {
      devLog('clipboard:read error:', e);
      return err('storage', '读取剪贴板失败');
    }
  });
}
