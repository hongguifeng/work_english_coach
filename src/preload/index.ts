import { contextBridge } from 'electron';
import { invoke } from './api';
import type { DesktopApi } from '../shared/types/desktopApi';
import type { Result } from '../shared/types/app';

/**
 * Preload 入口（T004 / T005 / T012）
 *
 * 安全规则（T005）：
 * - 通过 contextBridge 暴露最小 API（window.desktopAPI）
 * - 绝不暴露原始 ipcRenderer / require / process
 * - 所有方法返回 Result<T>
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
};

contextBridge.exposeInMainWorld('desktopAPI', desktopApi);

export type ExposedApi = typeof desktopApi;
export type { Result };
