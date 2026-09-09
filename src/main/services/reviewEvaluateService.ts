/**
 * 复习答案 AI 评价服务（T031）。
 *
 * 流程（docs/04 §7）：
 *   1. 组装 AI 请求配置（T020 模式：配置 + 凭据存储读 Key）
 *   2. 调 AI（system=评审优先级+不逐字匹配原则；user=题目+用户答案）
 *   3. Zod 校验（parseReviewEvaluation）—— 失败 = 友好错误，不落库
 *   4. feedbackZh 截取最多 3 条
 *   5. review_attempt 落库（只记录成功的评价）
 *
 * 失败语义（docs/08 T031）：AI 失败/解析失败时返回 err，答案保留在
 * 训练页 UI（暂存）供用户稍后重试——**不写 review_attempt**。
 */
import type { Result } from '../../shared/types/app';
import type { EvaluateReviewInput, ReviewEvaluation } from '../../shared/types/review';
import type { AiClient } from './aiClient';
import { OpenAICompatibleClient } from './aiClient';
import { buildAiRequestConfig } from './aiConfigService';
import { buildEvaluateSystemPrompt, buildEvaluateUserPrompt } from './aiPrompts';
import { parseReviewEvaluation } from './aiSchemas';
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
 * 评价一次复习答案。
 *
 * @returns
 *  - ok：ReviewEvaluation（feedbackZh 已截取 ≤3 条）
 *  - err：AI 未配置/Key 缺失/传输失败/超时/解析失败（分类错误，可重试）
 */
export async function evaluateReviewAnswer(
  input: EvaluateReviewAnswerInput,
  repos: { reviewTasks: ReviewTaskRepository },
  deps: ReviewEvaluateDeps,
): Promise<Result<ReviewEvaluation>> {
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

  return { ok: true, data: evaluation };
}
