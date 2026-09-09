// T030/T031 — 复习答题提交输入构造（纯逻辑，renderer/main 共用，可单测）
//
// 从「任务 + 用户作答 + 会话 flags」构造并校验 EvaluateReviewInput：
// - userAnswer 去除首尾空白后必须非空（防止空白提交）
// - usedHint / revealedAnswer 如实传入（T030 答题界面捕获，T031 评价与 review_attempt 使用）
// - 输出过 zod 校验（docs/02：所有 AI 输入/输出都校验）；失败 → 结构化错误（不抛异常）
import { z } from 'zod';
import { REVIEW_TASK_TYPES } from '../constants/review';
import type { EvaluateReviewInput, ReviewTask } from '../types/review';

export const evaluateReviewInputSchema: z.ZodType<EvaluateReviewInput> = z.object({
  taskType: z.enum(REVIEW_TASK_TYPES),
  promptZh: z.string().min(1),
  context: z.string(),
  keywords: z.array(z.string()),
  referenceAnswer: z.string(),
  userAnswer: z.string().min(1),
  usedHint: z.boolean(),
  revealedAnswer: z.boolean(),
});

export type BuildEvaluateResult =
  | { ok: true; data: EvaluateReviewInput }
  | { ok: false; error: string };

/**
 * 构造 EvaluateReviewInput。
 * `task` 来自今日任务列表（T029 视图模型）；`userAnswer`/flags 来自答题界面会话。
 * 任何字段非法（如空白答案）→ `{ ok: false, error }`，由调用方展示（不抛异常）。
 */
export function buildEvaluateInput(
  task: ReviewTask,
  userAnswer: string,
  usedHint: boolean,
  revealedAnswer: boolean,
): BuildEvaluateResult {
  const parsed = evaluateReviewInputSchema.safeParse({
    taskType: task.taskType,
    promptZh: task.promptZh,
    context: task.context,
    keywords: task.keywords,
    referenceAnswer: task.referenceAnswer,
    userAnswer: userAnswer.trim(),
    usedHint,
    revealedAnswer,
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return { ok: false, error: `作答无效（${issues}）` };
}
