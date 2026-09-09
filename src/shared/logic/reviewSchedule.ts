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

/**
 * T032：调度决策（docs/03 §3）。
 * - 独立答对次数（含本次）达到 REVIEW_INTERVALS_DAYS.length（5 次）→ 毕业（completed，不再排期）；
 * - 其他情况：按 outcome 与历史独立答对次数决定下一次间隔（答错/用提示/查看均回到 1 天，不升级）。
 * `correctNoHintCount` 为本次作答已落库后的累计独立答对次数。
 */
export type SchedulingDecision = { intervalDays: number; graduated: boolean };

export function computeScheduling(outcome: ReviewOutcome, correctNoHintCount: number): SchedulingDecision {
  if (outcome === 'correct_no_hint' && correctNoHintCount >= REVIEW_INTERVALS_DAYS.length) {
    return { intervalDays: 0, graduated: true };
  }
  // 独立答对：本次是第 correctNoHintCount 次 → 取前一次索引递进（1→3→7→14→30）
  const idx = Math.max(correctNoHintCount - 1, 0);
  return { intervalDays: nextReviewIntervalDays(outcome, idx), graduated: false };
}

/** 日期运算：base + days（86400 秒/天），ISO 8601 UTC（与 DB 统一存储格式）。 */
export function addDaysIso(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

/** T032：评价 + 调度的组合结果（IPC / 渲染进程共用）。 */
export type SchedulingResultView = {
  outcome: ReviewOutcome;
  graduated: boolean;
  intervalDays: number | null;
  nextScheduledAt: string | null;
};
