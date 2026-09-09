// WorkEnglish Coach — 数据管理 IPC（T017）
//
// 暴露的渠道：
//   data:export      弹系统保存对话框 → 写 JSON（不含 API Key）→ 回执路径
//   data:delete-all  删除全部学习数据（保留 settings），成功后向所有窗口广播 data:changed
//
// 安全与规则（docs/02、docs/06）：
// - 二次确认在渲染进程用 Popconfirm 完成（主进程不弹破坏性确认框）。
// - 所有渠道返回统一 Result<T>；异常经 classifyError 归类，绝不把原始堆栈/SQL 抛给 UI。
// - API Key 不在数据库中，导出文件结构性地不含它。
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { err, ok } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type {
  DataChangedEvent,
  DeleteSummary,
  ExportResult,
} from '../../shared/types/data';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { devLog } from '../log';
import {
  deleteAllLearningData,
  exportLearningData,
} from '../services/dataService';

const APP_NAME = 'WorkEnglish Coach';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

function dateStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 向所有打开的窗口广播数据变更事件（目前触发点：删除全部数据）。 */
function broadcastDataChanged(): void {
  const payload: DataChangedEvent = { at: new Date().toISOString() };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:changed', payload);
  }
}

export function registerDataIpc(): void {
  ipcMain.handle('data:export', async (): Promise<Result<ExportResult>> => {
    try {
      const owner =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        title: '导出学习数据',
        defaultPath: `work-english-coach-export-${dateStamp()}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      };
      const res = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (res.canceled || !res.filePath) {
        return ok({ path: null, skipped: true });
      }

      const dataset = exportLearningData(getDatabase(), {
        name: APP_NAME,
        version: app.getVersion(),
      });
      if (!dataset.ok) return dataset; // ErrResult（存储/结构错误）

      await writeFile(res.filePath, JSON.stringify(dataset.data, null, 2), 'utf8');
      devLog(`data:export ok (${res.filePath})`);
      return ok({ path: res.filePath, skipped: false });
    } catch (e) {
      devLog('data:export fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle('data:delete-all', (): Result<DeleteSummary> => {
    try {
      const result = deleteAllLearningData(getDatabase());
      if (result.ok) {
        devLog(`data:delete-all ok (total=${result.data.total})`);
        broadcastDataChanged();
      } else {
        devLog('data:delete-all fail:', result.error.debug ?? result.error.message);
      }
      return result;
    } catch (e) {
      devLog('data:delete-all fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
