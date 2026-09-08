/**
 * 复习间隔计算（纯函数，docs/03 §3）。
 * 工作区产出的错误知识点 / 表达会生成复习任务，
 * 下次复习间隔根据本次复习表现动态调整。
 */

/** 复习结果（由用户在复习任务中的表现归类） */
export type ReviewOutcome = 'correct_no_hint' | 'used_hint' | 'revealed' | 'wrong';

/** 递进间隔（天）：无提示答对时逐级延长，上限 30 天 */
export const REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

/**
 * 计算下一次复习间隔（天）。
 * - correct_no_hint：按 attemptIndex 递进（1→3→7→14→30，封顶 30）；
 * - used_hint / revealed / wrong：重置为 1 天（次日再来）。
 */
export function nextReviewIntervalDays(outcome: ReviewOutcome, attemptIndex: number): number {
  if (outcome === 'correct_no_hint') {
    const idx = Math.min(Math.max(attemptIndex, 0), REVIEW_INTERVALS_DAYS.length - 1);
    return REVIEW_INTERVALS_DAYS[idx] ?? 30;
  }
  return 1;
}
