import type { Result } from './app';
import type { DataChangedEvent, DeleteSummary, ExportResult } from './data';

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
  /** 导出全部学习数据为 JSON 文件（不含 API Key）。用户取消时 skipped=true（T017）。 */
  dataExport(): Promise<Result<ExportResult>>;
  /** 删除全部学习数据（保留 settings）。二次确认由调用方 UI 完成（T017）。 */
  dataDeleteAll(): Promise<Result<DeleteSummary>>;
  /**
   * 保存 API Key 到系统凭据存储（keytar/DPAPI）。渲染进程写入后不得再持有原文
   * （调用方应清空输入框）。仅返回操作结果，不返回 Key（T018）。
   */
  secretSet(key: string): Promise<Result<void>>;
  /** 清除 API Key（幂等）。仅返回操作结果（T018）。 */
  secretClear(): Promise<Result<void>>;
  /** 查询是否已配置 API Key（只返回布尔，绝不返回 Key 原文）（T018）。 */
  secretIsConfigured(): Promise<Result<boolean>>;
  /**
   * 订阅主进程的数据变更广播（目前触发点：删除全部数据）。
   * 返回取消订阅函数（用于 React useEffect 清理）（T017）。
   */
  onDataChanged(cb: (payload: DataChangedEvent) => void): () => void;
}

declare global {
  interface Window {
    desktopAPI: DesktopApi;
  }
}
