import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { invoke } from './api';
import type { DesktopApi } from '../shared/types/desktopApi';
import type { DataChangedEvent } from '../shared/types/data';
import type { Result } from '../shared/types/app';

/**
 * Preload 入口（T004 / T005 / T012 / T017）
 *
 * 安全规则（T005）：
 * - 通过 contextBridge 暴露最小 API（window.desktopAPI）
 * - 绝不暴露原始 ipcRenderer / require / process
 * - 所有方法返回 Result<T>
 * - 事件订阅返回取消函数，避免泄漏，且不暴露原始 ipcRenderer
 */
const desktopApi: DesktopApi = {
  ping: () => invoke<string>('app:ping'),
  info: () =>
    invoke<{
      appVersion: string;
      electronVersion: string;
      nodeVersion: string;
      platform: string;
    }>('app:info'),
  dataExport: () => invoke<import('../shared/types/data').ExportResult>('data:export'),
  dataDeleteAll: () =>
    invoke<import('../shared/types/data').DeleteSummary>('data:delete-all'),
  onDataChanged: (cb) => {
    const listener = (
      _e: IpcRendererEvent,
      payload: DataChangedEvent,
    ): void => {
      cb(payload);
    };
    ipcRenderer.on('data:changed', listener);
    return () => {
      ipcRenderer.removeListener('data:changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('desktopAPI', desktopApi);

export type ExposedApi = typeof desktopApi;
export type { Result };
