// T033 — 基础学习统计服务（主进程）
//
// 统计口径（docs/08 T033 注意）：
// - 全部基于 review_attempts / review_tasks / detected_issues，不基于 AI 修改记录。
// - 练习次数 = review_attempts 条数（一次提交一次计数）。
// - 独立完成 = 独立答对（coreMeaningCorrect 且未用提示、未查看参考答案）。
// - 不把 AI 自动修改次数算作掌握；不生成没有可靠依据的英语等级分数。
// - 无副作用：纯读查询，不改任何数据。
import { ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import { aggregateTrend, buildTrendBuckets, startOfWeek, topItems } from '../../shared/logic/studyStats';
import type { StudyStatsView } from '../../shared/types/studyStats';
import type { Repositories } from '../db/repositories';

const TREND_DAYS = 7;
const TOP_ERRORS_LIMIT = 5;

export type StudyStatsRepos = Pick<Repositories, 'reviewAttempts' | 'reviewTasks' | 'issues'>;

/** 读取基础学习统计（同步 DB 查询，无 AI）。 */
export function getStudyStats(repos: StudyStatsRepos, now: Date = new Date()): Result<StudyStatsView> {
  const weekStartIso = startOfWeek(now).toISOString();

  const rPractice = repos.reviewAttempts.listCreatedSince(weekStartIso);
  if (!rPractice.ok) return rPractice;
  const rIndependent = repos.reviewAttempts.countIndependentSince(weekStartIso);
  if (!rIndependent.ok) return rIndependent;
  const rEver = repos.reviewAttempts.countAll();
  if (!rEver.ok) return rEver;
  const rPending = repos.reviewTasks.countByStatus('pending');
  if (!rPending.ok) return rPending;
  const rIssues = repos.issues.countBySkillKey();
  if (!rIssues.ok) return rIssues;

  const weekPracticeCount = rPractice.data.length;
  const independentCount = rIndependent.data;
  const pendingTaskCount = rPending.data;
  const topErrors = topItems(rIssues.data, TOP_ERRORS_LIMIT);
  const trend = aggregateTrend(rPractice.data, buildTrendBuckets(now, TREND_DAYS));

  // 空状态判定：本周练习/近七天趋势/待复习/高频错误都为 0，且历史上也没有任何练习
  const hasAnyData =
    rEver.data > 0 || weekPracticeCount > 0 || pendingTaskCount > 0 || topErrors.length > 0;

  return ok({ weekPracticeCount, independentCount, pendingTaskCount, topErrors, trend, hasAnyData });
}
