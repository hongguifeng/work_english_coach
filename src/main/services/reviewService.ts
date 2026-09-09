// T029 — 今日任务查询服务（docs/08 T029）
//
// 职责：
// - 查询「已到期（scheduledAt <= 当前）且待完成（pending）」的复习任务，
//   优先显示错题（关联知识点 skillId），其次到期表达（expressionId），
//   再按到期时间先后排序。
// - 统计「今日已完成数」（completedAt >= 今日 0:00）与「待完成数」。
//
// electron-free：只依赖 repository，可在纯 Node 下用 node:sqlite 测试。
import { ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type {
  ReviewTask,
  TodayReviewView,
} from '../../shared/types/review';
import type { Repositories } from '../db/repositories';
import type { ReviewTaskRow } from '../db/schema';

/** keywords JSON → 字符串数组（非法/缺失 → 空数组，不抛异常——视图模型防御）。 */
function safeStringArray(raw: string | null): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed;
    }
  } catch {
    // 非法 JSON → 空数组
  }
  return [];
}

/** 把任务行转为 UI 视图模型（keywords JSON → 数组；context 空 → 空串；来源 id 可选）。 */
function rowToUiTask(row: ReviewTaskRow): ReviewTask {
  return {
    id: row.id,
    taskType: row.taskType,
    promptZh: row.promptZh,
    context: row.context ?? '',
    keywords: safeStringArray(row.keywords),
    referenceAnswer: row.referenceAnswer,
    status: row.status,
    scheduledAt: row.scheduledAt,
    ...(row.skillId ? { skillId: row.skillId } : {}),
    ...(row.expressionId ? { expressionId: row.expressionId } : {}),
  };
}

/** 排序：① 错题（skillId 非空）优先 ② 到期时间早的优先 ③ 主键稳定。 */
function comparePriority(a: ReviewTaskRow, b: ReviewTaskRow): number {
  const aSkill = a.skillId !== null ? 0 : 1;
  const bSkill = b.skillId !== null ? 0 : 1;
  if (aSkill !== bSkill) return aSkill - bSkill;
  if (a.scheduledAt !== b.scheduledAt) {
    return a.scheduledAt < b.scheduledAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * T029 — 查询今日任务。
 *
 * @param repos 仓储集合（只用 reviewTasks）
 * @param now   当前时间（测试可注入；默认 new Date()）
 */
export function getTodayReview(
  repos: Pick<Repositories, 'reviewTasks'>,
  now: Date = new Date(),
): Result<TodayReviewView> {
  const due = repos.reviewTasks.getDue(now.toISOString());
  if (!due.ok) return due;
  const sorted = [...due.data].sort(comparePriority);

  // 今日 0:00（本地时区）→ ISO
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const completed = repos.reviewTasks.countCompletedSince(startOfToday.toISOString());
  if (!completed.ok) return completed;

  return ok({
    tasks: sorted.map(rowToUiTask),
    completedToday: completed.data,
    pending: sorted.length,
  });
}
