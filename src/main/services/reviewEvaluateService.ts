/**
 * 复习答案 AI 评价服务（T031/T032）。
 *
 * 流程（docs/04 §7 + docs/03 §3）：
 *   1. 组装 AI 请求配置（T020 模式：配置 + 凭据存储读 Key）
 *   2. 调 AI（system=评审优先级+不逐字匹配原则；user=题目+用户答案）
 *   3. Zod 校验（parseReviewEvaluation）—— 失败 = 友好错误，不落库
 *   4. feedbackZh 截取最多 3 条
 *   5. review_attempt 落库（只记录成功的评价）
 *   6. T032 调度：由本次作答推导 ReviewOutcome → 原地改期（1/3/7/14/30 天）或毕业（completed）
 *
 * 失败语义（docs/08 T031）：AI 失败/解析失败时返回 err，答案保留在
 * 训练页 UI（暂存）供用户稍后重试——**不写 review_attempt、不调度**。
 */
import type { Result } from '../../shared/types/app';
import { ok } from '../../shared/types/app';
import type { EvaluateAnswerResult, EvaluateReviewInput, ReviewEvaluation } from '../../shared/types/review';
import { outcomeFromAttempt } from '../../shared/logic/mastery';
import type { AiClient } from './aiClient';
import { OpenAICompatibleClient } from './aiClient';
import { buildAiRequestConfig } from './aiConfigService';
import { buildEvaluateSystemPrompt, buildEvaluateUserPrompt } from './aiPrompts';
import { parseReviewEvaluation } from './aiSchemas';
import { applyReviewOutcome } from './reviewSchedulingService';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ReviewTaskRepository } from '../db/repositories/reviewTasks';
import type { SecretBackend } from './secretBackend';

/** 评价服务依赖（便于单测注入假 AI 客户端）。 */
export interface ReviewEvaluateDeps {
  getSettingsRepo: () => SettingsRepository;
  getSecretBackend: () => SecretBackend;
  /** 可选 AI 客户端注入；默认 OpenAICompatibleClient。 */
  client?: AiClient;
}

export interface EvaluateAnswerRequest {
  /** 任务主键（review_tasks.id；落 review_attempt 用） */
  taskId: string;
}

/** 评价入参 = 共享校验产物 + 落库所需的 taskId。 */
export type EvaluateReviewAnswerInput = EvaluateReviewInput & EvaluateAnswerRequest;

/**
 * 评价一次复习答案（含 T032 调度）。
 *
 * @returns
 *  - ok：{ evaluation, scheduling }——评价结果 + 调度结果（下次复习时间 / 已毕业）
 *  - err：AI 未配置/Key 缺失/传输失败/超时/解析失败（分类错误，可重试；不调度）
 *
 * 调度失败（改期写库异常）时仍返回 ok（评价已落库），scheduling 降级为「未排期」。
 */
export async function evaluateReviewAnswer(
  input: EvaluateReviewAnswerInput,
  repos: { reviewTasks: ReviewTaskRepository },
  deps: ReviewEvaluateDeps,
): Promise<Result<EvaluateAnswerResult>> {
  const config = await buildAiRequestConfig(deps.getSettingsRepo(), deps.getSecretBackend());
  if (!config.ok) return config;

  const client = deps.client ?? new OpenAICompatibleClient();
  const raw = await client.chat(config.data, [
    { role: 'system', content: buildEvaluateSystemPrompt() },
    { role: 'user', content: buildEvaluateUserPrompt(input) },
  ]);
  if (!raw.ok) return raw;

  const parsed = parseReviewEvaluation(raw.data);
  if (!parsed.ok) return parsed;

  const evaluation: ReviewEvaluation = { ...parsed.data, feedbackZh: parsed.data.feedbackZh.slice(0, 3) };

  const rec = repos.reviewTasks.recordAttempt({
    taskId: input.taskId,
    userAnswer: input.userAnswer,
    usedHint: input.usedHint,
    revealedAnswer: input.revealedAnswer,
    aiScore: evaluation.aiScore,
    coreMeaningCorrect: evaluation.coreMeaningCorrect,
    grammarCorrect: evaluation.grammarCorrect,
    toneAppropriate: evaluation.toneAppropriate,
    feedbackZh: evaluation.feedbackZh,
    improvedAnswer: evaluation.improvedAnswer,
  });
  if (!rec.ok) return rec;

  // T032：由本次作答推导复习结果并应用调度（改期或毕业）。
  // 调度失败不致命：评价已落库，返回降级 scheduling（未排期）。
  const outcome = outcomeFromAttempt({
    coreMeaningCorrect: evaluation.coreMeaningCorrect,
    usedHint: input.usedHint,
    revealedAnswer: input.revealedAnswer,
  });
  const sched = applyReviewOutcome(input.taskId, outcome, repos);
  if (sched.ok) return ok({ evaluation, scheduling: sched.data });
  console.warn(`[review] 调度失败（评价已落库）taskId=${input.taskId}:`, sched.error.message);
  return ok({
    evaluation,
    scheduling: { outcome, graduated: false, intervalDays: null, nextScheduledAt: null },
  });
}
