import type { Result } from './app';

/**
 * Preload 暴露给渲染进程的最小 API 接口（T012）
 *
 * 规则：
 * - 每个方法只暴露业务语义，不暴露原始 ipcRenderer
 * - 所有方法返回 Result<T>，渲染进程不直接处理异常
 * - 后续 todo 在此接口上增量添加方法，保持最小化
 */
export interface DesktopApi {
  /** 验证主进程 <-> 渲染进程链路（T006） */
  ping(): Promise<Result<string>>;
  /** 应用环境信息（诊断用） */
  info(): Promise<
    Result<{
      appVersion: string;
      electronVersion: string;
      nodeVersion: string;
      platform: string;
    }>
  >;
}

declare global {
  interface Window {
    desktopAPI: DesktopApi;
  }
}
