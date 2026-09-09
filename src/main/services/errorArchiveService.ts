import type { Result } from '../../shared/types/app';
import type { ErrorArchiveEntry, ErrorArchiveFilter } from '../../shared/types/errorArchive';
import { deriveMasteryStatus, outcomeFromAttempt } from '../../shared/logic/mastery';
import type { DetectedIssueRepository } from '../db/repositories/detectedIssues';
import type { ReviewAttemptRepository } from '../db/repositories/reviewAttempts';
import type { ReviewTaskRepository } from '../db/repositories/reviewTasks';
import type { SkillRepository } from '../db/repositories/skills';
import { toResult } from '../db/errors';
import type { DetectedIssueRow } from '../db/schema';
import type { IssueCategory } from '../../shared/types/ai';

/** 服务内组合仓储调用：失败时抛出（由外层 toResult 统一归类为 Result）。 */
function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error(r.error.message);
}

/** 每个知识点最多展示的示例条数 */
const EXAMPLES_PER_ENTRY = 3;

/** 错误档案服务所需的最小仓储集合（便于测试注入） */
export interface ErrorArchiveRepos {
  issues: Pick<DetectedIssueRepository, 'listAll'>;
  skills: Pick<SkillRepository, 'getByKey'>;
  reviewTasks: Pick<ReviewTaskRepository, 'getBySkill'>;
  reviewAttempts: Pick<ReviewAttemptRepository, 'getByTaskId'>;
}

/**
 * 构建错误档案（T027，docs/04 §6 前置的「错误档案」视图）：
 * - 按 skillKey 聚合 detected_issues（同一知识点聚合多次错误）
 * - 区分真正错误（severity=error）与表达建议（其余 severity）
 * - 关联练习历史（review_tasks → review_attempts）推导最近练习与掌握状态
 *   （产品原则 3：AI 的修改本身不算掌握，只有独立答对才算）
 *
 * 排序：最近出现时间倒序。
 */
export function buildErrorArchive(
  repos: ErrorArchiveRepos,
  filter: ErrorArchiveFilter = {},
): Result<ErrorArchiveEntry[]> {
  return toResult(() => {
    const allIssues = unwrap(repos.issues.listAll());

    // 按 skillKey 聚合
    type Agg = {
      issues: DetectedIssueRow[];
      lastSeenAt: string;
    };
    const bySkill = new Map<string, Agg>();
    for (const issue of allIssues) {
      const agg = bySkill.get(issue.skillKey) ?? { issues: [], lastSeenAt: '' };
      agg.issues.push(issue);
      if (issue.createdAt > agg.lastSeenAt) agg.lastSeenAt = issue.createdAt;
      bySkill.set(issue.skillKey, agg);
    }

    const entries: ErrorArchiveEntry[] = [];
    for (const [skillKey, agg] of bySkill) {
      const errorCount = agg.issues.filter((i) => i.severity === 'error').length;
      const suggestionCount = agg.issues.length - errorCount;
      if (filter.severity === 'error' && errorCount === 0) continue;
      if (filter.severity === 'suggestion' && suggestionCount === 0) continue;

      const skill = unwrap(repos.skills.getByKey(skillKey)) as
        | { title: string; category: IssueCategory; explanationZh: string; id: string }
        | null;
      const category = skill?.category ?? agg.issues[0]?.category ?? 'other';
      if (filter.category && category !== filter.category) continue;

      // 练习历史（仅当知识点存在于 skills 表时才有任务）
      let lastPracticeAt: string | null = null;
      let lastPracticeCorrect: boolean | null = null;
      let masteryStatus: 'new' | 'learning' | 'familiar' = 'new';
      if (skill) {
        const tasks = unwrap(repos.reviewTasks.getBySkill(skill.id)) as
          Array<{ id: string }>;
        const outcomes: Array<
          ReturnType<typeof outcomeFromAttempt>
        > = [];
        let latestAttempt: {
          createdAt: string;
          coreMeaningCorrect?: boolean | null;
          usedHint: boolean;
          revealedAnswer: boolean;
        } | null = null;
        for (const task of tasks) {
          const attempts = unwrap(repos.reviewAttempts.getByTaskId(task.id)) as Array<{
            createdAt: string;
            coreMeaningCorrect?: boolean | null;
            usedHint: boolean;
            revealedAnswer: boolean;
          }>;
          // getByTaskId 为 createdAt 倒序 → 反转为时间正序
          for (const a of [...attempts].reverse()) {
            outcomes.push(outcomeFromAttempt(a));
            if (!latestAttempt || a.createdAt > latestAttempt.createdAt) {
              latestAttempt = a;
            }
          }
        }
        if (latestAttempt) {
          lastPracticeAt = latestAttempt.createdAt;
          lastPracticeCorrect = outcomeFromAttempt(latestAttempt) === 'correct_no_hint';
          masteryStatus = deriveMasteryStatus(outcomes);
        }
      }

      const examples = agg.issues
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, EXAMPLES_PER_ENTRY)
        .map((i) => ({
          originalText: i.originalText,
          correctedText: i.correctedText,
          explanationZh: i.explanationZh,
          severity: i.severity,
          createdAt: i.createdAt,
        }));

      entries.push({
        skillKey,
        title: skill?.title ?? skillKey,
        category,
        explanationZh: skill?.explanationZh ?? agg.issues[0]?.explanationZh ?? '',
        count: agg.issues.length,
        errorCount,
        suggestionCount,
        lastSeenAt: agg.lastSeenAt,
        lastPracticeAt,
        lastPracticeCorrect,
        masteryStatus,
        examples,
      });
    }

    entries.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
    return entries;
  });
}
