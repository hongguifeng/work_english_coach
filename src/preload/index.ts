import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { invoke } from './api';
import type { DesktopApi } from '../shared/types/desktopApi';
import type { DataChangedEvent } from '../shared/types/data';
import type { Result } from '../shared/types/app';
import type {
  AiConnectionTestInput,
  AiConnectionTestResult,
  AiSettings,
  CopilotLoginInfo,
  CopilotModel,
} from '../shared/types/settings';
import type { AnalyzeDraftInput, AnalyzeDraftResult } from '../shared/types/ai';
import type { SaveCorrectionPayload, SaveCorrectionSummary } from '../shared/types/saveResult';
import type { HistoryRecord, HistoryRecordSummary } from '../shared/types/history';
import type {
  CreateExpressionInput,
  ExpressionRecord,
  ExpressionStatus,
  UpdateExpressionInput,
} from '../shared/types/library';
import type {
  EvaluateAnswerResult,
  ReviewEvaluateAnswerPayload,
  ReviewGenerateTaskInput,
  ReviewTaskGeneratedView,
  TodayReviewView,
} from '../shared/types/review';
import type { StudyStatsView } from '../shared/types/studyStats';
import type { RecordingSavedView } from '../shared/types/recording';

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
  copilotBeginLogin: () => invoke<CopilotLoginInfo>('copilot:begin-login'),
  copilotCompleteLogin: () => invoke<void>('copilot:complete-login'),
  copilotLogout: () => invoke<void>('copilot:logout'),
  copilotIsConfigured: () => invoke<boolean>('copilot:is-configured'),
  copilotListModels: () => invoke<CopilotModel[]>('copilot:list-models'),
  // T042：测试连接（真实最小 AI 调用）；Key 只在主进程，响应内容丢弃只返回耗时。
  aiTestConnection: (input: AiConnectionTestInput) =>
    invoke<AiConnectionTestResult>('ai:test-connection', input),
  // T022：草稿检查（AI 纠错）。API Key 只在主进程；结果经 Zod 校验后返回。
  aiAnalyzeDraft: (input: AnalyzeDraftInput, requestId: string) =>
    invoke<AnalyzeDraftResult>('ai:analyze-draft', input, requestId),
  aiAnalyzeDraftCancel: (requestId: string) => invoke<boolean>('ai:analyze-draft-cancel', requestId),
  clipboardWrite: (text: string) => invoke<boolean>('clipboard:write', text),
  clipboardRead: () => invoke<string>('clipboard:read'),
  // T025：保存纠错结果（主进程在 IPC 边界重新 Zod 校验后写库）。
  saveAnalysisResult: (payload: SaveCorrectionPayload) =>
    invoke<SaveCorrectionSummary>('result:save', payload),
  historyList: () => invoke<HistoryRecordSummary[]>('history:list'),
  historyGet: (id: string) => invoke<HistoryRecord | null>('history:get', id),
  historyDelete: (id: string) => invoke<boolean>('history:delete', id),
  // T026：表达库 CRUD（数据来自 SQLite；主进程在 IPC 边界重新 Zod 校验）。
  expressionList: () => invoke<ExpressionRecord[]>('expression:list'),
  expressionCreate: (input: CreateExpressionInput) =>
    invoke<ExpressionRecord>('expression:create', input),
  expressionUpdate: (id: string, patch: UpdateExpressionInput) =>
    invoke<ExpressionRecord>('expression:update', id, patch),
  expressionDelete: (id: string) => invoke<boolean>('expression:delete', id),
  expressionSetStatus: (id: string, status: ExpressionStatus) =>
    invoke<ExpressionRecord>('expression:set-status', id, status),
  // T027：错误档案（按 skillKey 聚合；可过滤类别 / 错误vs建议）。
  errorArchiveList: (filter?: import('../shared/types/errorArchive').ErrorArchiveFilter) =>
    invoke<import('../shared/types/errorArchive').ErrorArchiveEntry[]>('archive:errors', filter),
  // T028：从知识点/表达生成一道新练习（AI）→ 写入 review_tasks。
  // skill 源的 id 可以是主键或 skillKey；去重时 created=false（已有待完成任务）。
  reviewGenerateTask: (input: ReviewGenerateTaskInput) =>
    invoke<ReviewTaskGeneratedView>('review:generate-task', input),
  // T029：今日任务查询（到期且待完成，错题优先）+ 今日已完成数/待完成数。
  reviewToday: () => invoke<TodayReviewView>('review:today'),
  // T031/T032：复习答案 AI 评价（调 AI）；成功时主进程写 review_attempt 并应用调度；
  // 返回 { evaluation, scheduling }；
  // 失败时返回 err（答案保留在训练页供重试，不落库/不调度）。
  reviewEvaluateAnswer: (payload: ReviewEvaluateAnswerPayload) =>
    invoke<EvaluateAnswerResult>('review:evaluate-answer', payload),
  // T032：跳过今日任务（不计成绩，status='skipped'）。
  reviewSkipTask: (payload: { taskId: string }) => invoke<{ taskId: string }>('review:skip-task', payload),
  // T033：基础学习统计（纯 DB 查询，无 AI）。
  studyStats: () => invoke<StudyStatsView>('stats:study'),
  // T034：录音（临时目录，启动时清理 7 天前的文件；不默认永久保存）。
  saveRecording: (data: ArrayBuffer, mimeType: string) =>
    invoke<RecordingSavedView>('rec:save', { data, mimeType }),
  deleteRecording: (id: string) => invoke<null>('rec:delete', { id }),
  listRecordings: () => invoke<RecordingSavedView[]>('rec:list'),
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
