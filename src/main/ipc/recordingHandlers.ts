// T034 — 录音 IPC（主进程）
//
// 暴露的渠道：
//   rec:save   保存渲染进程传来的音频（ArrayBuffer）到临时目录
//   rec:delete 删除录音（仅 UUID id）
//   rec:list   列出临时目录中的录音
//
// 安全（docs/01、docs/08 T034）：
// - 数据来自受信任的 renderer（contextIsolation + 最小 API），但体积/内容不写日志。
// - id 校验在 store 层完成（isSafeRecordingId），防路径穿越。
import { ipcMain } from 'electron';
import { err } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { RecordingSavedView } from '../../shared/types/recording';
import { deleteRecording, listRecordings, saveRecording } from '../services/recordingStore';
import { devLog } from '../log';

/** 日志只记录 id 与大小，不记录音频内容（隐私）。 */
function logSaveResult(r: Result<RecordingSavedView>): void {
  if (r.ok) devLog(`rec:save -> ok (id=${r.data.id}, ${r.data.sizeBytes}B)`);
  else devLog(`rec:save -> fail (${r.error.code})`);
}

export function registerRecordingIpc(): void {
  ipcMain.handle('rec:save', async (_e, payload: { data: ArrayBuffer; mimeType: string }): Promise<Result<RecordingSavedView>> => {
    if (!payload || !(payload.data instanceof ArrayBuffer) || typeof payload.mimeType !== 'string') {
      return err('validation', '录音数据格式无效');
    }
    try {
      const r = saveRecording(payload.data, payload.mimeType);
      logSaveResult(r);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('storage', `保存录音失败: ${msg}`);
    }
  });

  ipcMain.handle('rec:delete', async (_e, payload: { id: string }): Promise<Result<null>> => {
    if (!payload || typeof payload.id !== 'string') {
      return err('validation', '录音 id 无效');
    }
    try {
      const r = deleteRecording(payload.id);
      if (r.ok) devLog(`rec:delete -> ok (id=${payload.id})`);
      else devLog(`rec:delete -> fail (${r.error.code})`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('storage', `删除录音失败: ${msg}`);
    }
  });

  ipcMain.handle('rec:list', async (): Promise<Result<RecordingSavedView[]>> => {
    try {
      const r = listRecordings();
      if (r.ok) devLog(`rec:list -> ok (${r.data.length} items)`);
      else devLog(`rec:list -> fail (${r.error.code})`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('storage', `读取录音列表失败: ${msg}`);
    }
  });
}
