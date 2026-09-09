import type { Result } from './app';
import type { AiSettings } from './settings';
import type { DataChangedEvent, DeleteSummary, ExportResult } from './data';
import type { AnalyzeDraftInput, AnalyzeDraftResult } from './ai';
import type { SaveCorrectionPayload, SaveCorrectionSummary } from './saveResult';

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
  /** 读取已持久化的 AI 非密钥配置（缺失/损坏 → 默认值；绝不含 API Key）（T019）。 */
  aiConfigGet(): Promise<Result<AiSettings>>;
  /** 校验并持久化 AI 非密钥配置（非法输入 → validation 错误；绝不含 API Key）（T019）。 */
  aiConfigSave(settings: AiSettings): Promise<Result<AiSettings>>;
  /**
   * 提交草稿进行 AI 检查，返回结构化纠错结果（AnalyzeDraftResult）。
   * 非法输入 → validation；未配 Key → config；超时 → timeout；
   * 用户取消 → canceled；网络故障 → network；AI 返回非法结构 → parse（T022）。
   */
  aiAnalyzeDraft(input: AnalyzeDraftInput, requestId: string): Promise<Result<AnalyzeDraftResult>>;
  /** 取消一个进行中的草稿检查请求（按 requestId）；返回是否命中并中止（T022）。 */
  aiAnalyzeDraftCancel(requestId: string): Promise<Result<boolean>>;
  /** 把文本写入系统剪贴板（成功 ok(true)；异常 storage 错误）（T024）。 */
  clipboardWrite(text: string): Promise<Result<boolean>>;
  /**
   * 用户确认纠错结果后保存到数据库：样本 + 错误列表 + 重点知识点（upsert），
   * 可选把自然表达版存为表达。隐私：saveOriginal=false 时不写入原文
   * （知识点/表达仍可用于复习）。非法载荷 → validation（T025）。
   */
  saveAnalysisResult(payload: SaveCorrectionPayload): Promise<Result<SaveCorrectionSummary>>;
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
