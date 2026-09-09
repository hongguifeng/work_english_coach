import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { invoke } from './api';
import type { DesktopApi } from '../shared/types/desktopApi';
import type { DataChangedEvent } from '../shared/types/data';
import type { Result } from '../shared/types/app';
import type { AiSettings } from '../shared/types/settings';

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
  // T018：API Key 走系统凭据存储（keytar/DPAPI）。渲染进程永远拿不到原始 Key。
  secretSet: (key: string) => invoke<void>('secret:set', key),
  secretClear: () => invoke<void>('secret:clear'),
  secretIsConfigured: () => invoke<boolean>('secret:is-configured'),
  // T019：AI 非密钥配置持久化到 SQLite settings 表（绝不含 API Key）。
  aiConfigGet: () => invoke<AiSettings>('aiConfig:get'),
  aiConfigSave: (settings: AiSettings) => invoke<AiSettings>('aiConfig:save', settings),
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
