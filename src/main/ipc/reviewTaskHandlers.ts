// T028 — 复习任务生成 IPC（主进程）
//
// 暴露的渠道：
//   review:generate-task  从知识点/表达生成一道新练习（调 AI）→ 写入 review_tasks
//   review:today          今日任务查询（到期且待完成，错题优先）+ 今日已完成/待完成数
//   review:evaluate-answer  评价复习答案（T031，调 AI）→ 写入 review_attempt + 调度（T032 改期/毕业）
//   review:skip-task        跳过今日任务（T032，status='skipped'，不计成绩）
//
// 安全与规则（docs/02、docs/06、docs/08 T028）：
// - 入参在 IPC 边界用 Zod 校验；非法 → validation 错误。
// - AI 输出再经 Zod 校验（非法 → parse 错误，不写库）。
// - API Key 只在主进程内部（凭据存储），从不经过 IPC 返回给渲染进程。
// - 返回统一 Result<ReviewTaskGeneratedView>；日志只记录结果码，不记录练习原文。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { err, ok } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { EvaluateAnswerResult, ReviewGenerateTaskInput, ReviewTaskGeneratedView, TodayReviewView } from '../../shared/types/review';
import { REVIEW_TASK_TYPES } from '../services/aiSchemas';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { SettingsRepository } from '../db/repositories/settings';
import { getTodayReview } from '../services/reviewService';
import { generateReviewTask, rowToTaskView } from '../services/reviewTaskService';
import { evaluateReviewAnswer } from '../services/reviewEvaluateService';
import { getSharedSecretBackend } from '../services/secretService';
import { devLog } from '../log';

const reviewGenerateInputSchema = z.object({
  source: z.enum(['skill', 'expression']),
  id: z.string().min(1),
  taskType: z.enum(REVIEW_TASK_TYPES).optional(),
});

// T031：复习答案评价入参（= taskId + EvaluateReviewInput 字段，IPC 边界重声明）。
const reviewEvaluateInputSchema = z.object({
  taskId: z.string().min(1),
  taskType: z.enum(REVIEW_TASK_TYPES),
  promptZh: z.string().min(1),
  context: z.string(),
  keywords: z.array(z.string()),
  referenceAnswer: z.string(),
  userAnswer: z.string().min(1),
  usedHint: z.boolean(),
  revealedAnswer: z.boolean(),
});

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerReviewTaskIpc(): void {
  ipcMain.handle(
    'review:generate-task',
    async (_e, raw: unknown): Promise<Result<ReviewTaskGeneratedView>> => {
      const parsed = reviewGenerateInputSchema.safeParse(raw);
      if (!parsed.success) {
        return err('validation', '复习任务生成参数非法: ' + parsed.error.issues[0]?.message);
      }
      const input: ReviewGenerateTaskInput = parsed.data;
      const deps = {
        getSettingsRepo: () => new SettingsRepository(getDatabase()),
        getSecretBackend: () => getSharedSecretBackend(),
      };
      try {
        const r = await generateReviewTask(input, createRepositories(getDatabase()), deps);
        if (r.ok) {
          // 只记录结果码与去重标志，不记录练习原文（避免敏感工作文本进日志）
          devLog(`review:generate-task -> ok (created=${r.data.created})`);
          return { ok: true, data: { created: r.data.created, task: rowToTaskView(r.data.task) } };
        }
        devLog(`review:generate-task -> ${r.error.code}`);
        return r;
      } catch (e) {
        devLog('review:generate-task fail:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );

  // T029：今日任务查询（同步：纯 DB 查询，无 AI）。
  ipcMain.handle('review:today', async (): Promise<Result<TodayReviewView>> => {
    try {
      const r = getTodayReview(createRepositories(getDatabase()));
      if (r.ok) devLog(`review:today -> ok (pending=${r.data.pending}, completedToday=${r.data.completedToday})`);
      return r;
    } catch (e) {
      devLog('review:today fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  // T031/T032：评价复习答案（异步：调 AI）+ 调度（原地改期或毕业）。
  // 失败时不写 review_attempt、不调度（渲染端暂存答案供重试）。
  ipcMain.handle('review:evaluate-answer', async (_e, raw: unknown): Promise<Result<EvaluateAnswerResult>> => {
    const parsed = reviewEvaluateInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err('validation', '复习答案评价参数非法: ' + parsed.error.issues[0]?.message);
    }
    const deps = {
      getSettingsRepo: () => new SettingsRepository(getDatabase()),
      getSecretBackend: () => getSharedSecretBackend(),
    };
    try {
      const r = await evaluateReviewAnswer(parsed.data, createRepositories(getDatabase()), deps);
      if (r.ok) {
        // 只记录结果码、分数与调度结果，不记录答案/反馈原文（避免敏感工作文本进日志）
        devLog(
          `review:evaluate-answer -> ok (score=${r.data.evaluation.aiScore}, ` +
            `${r.data.scheduling.graduated ? 'graduated' : `nextIn=${r.data.scheduling.intervalDays}d`})`,
        );
      } else {
        devLog(`review:evaluate-answer -> ${r.error.code}`);
      }
      return r;
    } catch (e) {
      devLog('review:evaluate-answer fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  // T032：跳过今日任务（不计成绩、不写 attempt；status='skipped'）。
  const reviewSkipInputSchema = z.object({ taskId: z.string().min(1) });
  ipcMain.handle('review:skip-task', (_e, raw: unknown): Result<{ taskId: string }> => {
    const parsed = reviewSkipInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err('validation', '跳过任务参数非法: ' + parsed.error.issues[0]?.message);
    }
    try {
      const r = createRepositories(getDatabase()).reviewTasks.skip(parsed.data.taskId);
      if (r.ok) {
        devLog(`review:skip-task -> ok (taskId=${parsed.data.taskId})`);
        return ok({ taskId: parsed.data.taskId });
      }
      return r;
    } catch (e) {
      devLog('review:skip-task fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
