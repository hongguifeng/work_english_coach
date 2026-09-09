/**
 * 复习调度服务（T032，docs/03 §3 / docs/04 §7）。
 *
 * 职责：把一次复习结果（ReviewOutcome）应用到复习任务上：
 *   - 独立答对次数达 5（REVIEW_INTERVALS_DAYS.length）→ 毕业（completed，不再排期）；
 *   - 其他 → 原地改期（scheduledAt = now + intervalDays，status 保持/恢复 pending），
 *     答错/用提示/查看 → 1 天（次日）；独立答对 → 按累计次数递进 1→3→7→14→30。
 *
 * 纯函数决策（computeScheduling / addDaysIso）在 shared/logic/reviewSchedule.ts；
 * 本服务只做「读任务 → 决策 → 写库」的编排，便于注入仓储单测。
 */
import type { Result } from '../../shared/types/app';
import { err, ok } from '../../shared/types/app';
import { addDaysIso, computeScheduling, type ReviewOutcome, type SchedulingResultView } from '../../shared/logic/reviewSchedule';
import type { ReviewTaskRepository } from '../db/repositories/reviewTasks';

/**
 * 应用一次复习结果到任务（T032）。
 * @param taskId review_tasks 主键
 * @param outcome 本次作答的复习结果（由 outcomeFromAttempt 从 attempt 推导）
 * @param repos 仅需 reviewTasks 仓储（便于单测注入）
 * @param now 基准时间（测试注入用；缺省 new Date()）
 *
 * 语义：
 *  - 毕业：status='completed'（completedAt=now），不再排期；
 *  - 改期：status='pending' + scheduledAt=addDaysIso(now, intervalDays)（原地更新，
 *    不新建行 → 避免与 T028 的 pending 去重冲突）；
 *  - 任务不存在 → err('not-found')。
 */
export function applyReviewOutcome(
  taskId: string,
  outcome: ReviewOutcome,
  repos: { reviewTasks: ReviewTaskRepository },
  now?: Date,
): Result<SchedulingResultView> {
  const t = now ?? new Date();
  const task = repos.reviewTasks.get(taskId);
  if (!task.ok) return task;
  if (!task.data) return err('storage', '复习任务不存在: ' + taskId);

  const count = repos.reviewTasks.countCorrectNoHint(taskId);
  if (!count.ok) return count;

  const decision = computeScheduling(outcome, count.data);
  if (decision.graduated) {
    const r = repos.reviewTasks.complete(taskId, t.toISOString());
    if (!r.ok) return r;
    return ok({ outcome, graduated: true, intervalDays: null, nextScheduledAt: null });
  }

  const nextScheduledAt = addDaysIso(t, decision.intervalDays);
  const r = repos.reviewTasks.reschedule(taskId, nextScheduledAt, t.toISOString());
  if (!r.ok) return r;
  return ok({ outcome, graduated: false, intervalDays: decision.intervalDays, nextScheduledAt });
}
