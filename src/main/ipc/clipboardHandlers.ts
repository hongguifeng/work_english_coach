import { ipcMain } from 'electron';
import { err, type Result } from '../../shared/types/app';
import { devLog } from '../log';
import { getSharedClipboardBackend, writeClipboardText } from '../services/clipboardService';

/**
 * 注册剪贴板相关 IPC（T024）。
 * - clipboard:write：把指定文本写入系统剪贴板（参数做 Zod 校验）。
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
}
