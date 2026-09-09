import type { Result } from './app';
import type { AiSettings } from './settings';
import type { DataChangedEvent, DeleteSummary, ExportResult } from './data';
import type { AnalyzeDraftInput, AnalyzeDraftResult } from './ai';
import type { SaveCorrectionPayload, SaveCorrectionSummary } from './saveResult';
import type {
  CreateExpressionInput,
  ExpressionRecord,
  ExpressionStatus,
  UpdateExpressionInput,
} from './library';
import type {
  EvaluateAnswerResult,
  ReviewEvaluateAnswerPayload,
  ReviewGenerateTaskInput,
  ReviewTaskGeneratedView,
  TodayReviewView,
} from './review';
import type { StudyStatsView } from './studyStats';
import type { RecordingSavedView } from './recording';

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
  /** 列出全部表达（含归档），按创建时间倒序；搜索/筛选在页面侧完成（T026）。 */
  expressionList(): Promise<Result<ExpressionRecord[]>>;
  /** 手动新增表达（非法载荷 → validation）（T026）。 */
  expressionCreate(input: CreateExpressionInput): Promise<Result<ExpressionRecord>>;
  /** 编辑表达（含归档/恢复；非法载荷 → validation；id 不存在 → storage）（T026）。 */
  expressionUpdate(id: string, patch: UpdateExpressionInput): Promise<Result<ExpressionRecord>>;
  /** 永久删除表达（不可恢复，UI 需二次确认）；返回是否实际删除（T026）。 */
  expressionDelete(id: string): Promise<Result<boolean>>;
  /** 归档 / 恢复表达（T026）。 */
  expressionSetStatus(id: string, status: ExpressionStatus): Promise<Result<ExpressionRecord>>;
  /**
   * 错误档案（T027）：按 skillKey 聚合的历史错误。
   * 过滤：category（错误类别）、severity（error=真正错误 / suggestion=表达建议类）。
   */
  errorArchiveList(
    filter?: import('./errorArchive').ErrorArchiveFilter,
  ): Promise<Result<import('./errorArchive').ErrorArchiveEntry[]>>;
  /**
   * 从知识点/表达生成一道新的复习练习（T028）：调 AI 产出
   * 中文指令 + 场景 + 判分关键词 + 英文参考答案，并写入 review_tasks。
   * - skill 源的 id 可以是 skills 主键或 skillKey（错误档案页只持有 skillKey）；
   * - expression 源的 id 必须是 expressions 主键。
   * 返回 created=false 表示该来源已有待完成任务（去重，返回现有任务）。
   */
  reviewGenerateTask(input: ReviewGenerateTaskInput): Promise<Result<ReviewTaskGeneratedView>>;
  /** T029：今日任务查询（到期且待完成，错题优先）+ 今日已完成数/待完成数。 */
  reviewToday(): Promise<Result<TodayReviewView>>;
  /**
   * T031/T032：复习答案 AI 评价（调 AI；成功时主进程写 review_attempt 并应用调度）。
   * 返回 { evaluation, scheduling }：评价结果 + 下次复习时间（或已毕业）。
   * 评审原则：不逐字匹配，意思对但措辞不同不判错（docs/04 §7）。
   * 失败（未配置/超时/解析失败）返回 err；答案保留在训练页供重试，不落库、不调度。
   */
  reviewEvaluateAnswer(payload: ReviewEvaluateAnswerPayload): Promise<Result<EvaluateAnswerResult>>;
  /**
   * T032：跳过今日任务（不计成绩、不写 attempt；status='skipped'，不再到期）。
   */
  reviewSkipTask(payload: { taskId: string }): Promise<Result<{ taskId: string }>>;
  /**
   * T033：基础学习统计（本周练习/独立完成/待复习/高频错误/近七天趋势）。
   * 基于 review_attempts；AI 自动修改不算掌握，不生成等级分数。
   */
  studyStats(): Promise<Result<StudyStatsView>>;

  /**
   * T034：保存录音到临时目录（默认不永久保存；启动时自动清理 7 天前的文件）。
   * data 来自 MediaRecorder Blob（ArrayBuffer，结构化克隆安全）。
   */
  saveRecording(data: ArrayBuffer, mimeType: string): Promise<Result<RecordingSavedView>>;
  /** T034：删除录音（UUID id；不存在时幂等成功）。 */
  deleteRecording(id: string): Promise<Result<null>>;
  /** T034：列出临时目录中的录音（时间倒序）。 */
  listRecordings(): Promise<Result<RecordingSavedView[]>>;
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
