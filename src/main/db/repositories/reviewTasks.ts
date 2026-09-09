import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ReviewTaskStatus, ReviewTaskType } from '../../../shared/types/review';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import { jsonEncode, parseStringArray } from '../json';
import type { ReviewAttemptRow, ReviewTaskRow } from '../schema';
import { reviewAttempts, reviewTasks } from '../schema';

export interface CreateReviewTaskInput {
  taskType: ReviewTaskType;
  skillId?: string | null;
  expressionId?: string | null;
  promptZh: string;
  context?: string | null;
  keywords?: readonly string[] | null;
  referenceAnswer: string;
  acceptableAnswers?: readonly string[] | null;
  /** ISO 8601 UTC（到期时间） */
  scheduledAt: string;
}

/**
 * review_tasks 表仓储（复习任务，docs/03 §2.5）。
 * 支撑 T028–T032：到期查询、完成标记、掌握后改期、按来源查询。
 */
export class ReviewTaskRepository {
  constructor(private readonly db: SqlDb) {}

  create(input: CreateReviewTaskInput): Result<ReviewTaskRow> {
    return toResult(() => {
      const row = this.db
        .insert(reviewTasks)
        .values({
          id: randomUUID(),
          taskType: input.taskType,
          skillId: input.skillId ?? null,
          expressionId: input.expressionId ?? null,
          promptZh: input.promptZh,
          context: input.context ?? null,
          keywords: jsonEncode(input.keywords),
          referenceAnswer: input.referenceAnswer,
          acceptableAnswers: jsonEncode(input.acceptableAnswers),
          status: 'pending',
          scheduledAt: input.scheduledAt,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();
      if (!row) throw new Error('复习任务创建后未找到');
      return row;
    });
  }

  get(id: string): Result<ReviewTaskRow | null> {
    return toResult(() => this.db.select().from(reviewTasks).where(eq(reviewTasks.id, id)).get() ?? null);
  }

  /** 解析 keywords / acceptableAnswers JSON 字段后的任务（供 UI 展示提示词）。 */
  getParsed(
    id: string,
  ): Result<Omit<ReviewTaskRow, 'keywords' | 'acceptableAnswers'> & { keywords: string[]; acceptableAnswers: string[] } | null> {
    return toResult(() => {
      const row = this.db.select().from(reviewTasks).where(eq(reviewTasks.id, id)).get();
      if (!row) return null;
      return { ...row, keywords: parseStringArray(row.keywords), acceptableAnswers: parseStringArray(row.acceptableAnswers) };
    });
  }

  /** 到期且待完成的复习任务（scheduledAt <= now 且 status='pending'），按到期先后排序。 */
  getDue(now: string = new Date().toISOString()): Result<ReviewTaskRow[]> {
    return toResult(() =>
      this.db
        .select()
        .from(reviewTasks)
        .where(and(eq(reviewTasks.status, 'pending'), lte(reviewTasks.scheduledAt, now)))
        .orderBy(asc(reviewTasks.scheduledAt))
        .all(),
    );
  }

  complete(id: string): Result<ReviewTaskRow> {
    return toResult(() => {
      const row = this.db
        .update(reviewTasks)
        .set({ status: 'completed', completedAt: new Date().toISOString() })
        .where(eq(reviewTasks.id, id))
        .returning()
        .get();
      if (!row) throw new Error('复习任务完成标记失败: ' + id);
      return row;
    });
  }

  /** 掌握后按下次间隔改期（重置为 pending）。 */
  reschedule(id: string, nextScheduledAt: string): Result<ReviewTaskRow> {
    return toResult(() => {
      const row = this.db
        .update(reviewTasks)
        .set({ scheduledAt: nextScheduledAt, status: 'pending' })
        .where(eq(reviewTasks.id, id))
        .returning()
        .get();
      if (!row) throw new Error('复习任务改期失败: ' + id);
      return row;
    });
  }

  /**
   * T029 — 统计某时间点之后完成的任务数（“今日已完成”计数）。
   * sinceIso 为本地今日 0:00 的 ISO 时间。
   */
  countCompletedSince(sinceIso: string): Result<number> {
    return toResult(() => {
      const rows = this.db
        .select({ n: sql<number>`count(*)` })
        .from(reviewTasks)
        .where(
          and(
            eq(reviewTasks.status, 'completed'),
            sql`${reviewTasks.completedAt} >= ${sinceIso}`,
          ),
        )
        .all();
      return rows[0]?.n ?? 0;
    });
  }

  getBySkill(skillId: string): Result<ReviewTaskRow[]> {
    return toResult(() => this.db.select().from(reviewTasks).where(eq(reviewTasks.skillId, skillId)).all());
  }

  getByExpression(expressionId: string): Result<ReviewTaskRow[]> {
    return toResult(() => this.db.select().from(reviewTasks).where(eq(reviewTasks.expressionId, expressionId)).all());
  }

  list(status?: ReviewTaskStatus): Result<ReviewTaskRow[]> {
    return toResult(() => {
      const base = this.db.select().from(reviewTasks);
      const q = status ? base.where(eq(reviewTasks.status, status)) : base;
      return q.orderBy(desc(reviewTasks.createdAt)).all();
    });
  }

  /**
   * T031 — 记录一次复习尝试（AI 评价完成后落库）。
   * usedHint/revealedAnswer 为 0/1；feedbackZh 为 JSON 数组字符串（最多 3 条，服务层已截取）。
   */
  recordAttempt(input: {
    taskId: string;
    userAnswer: string;
    usedHint: boolean;
    revealedAnswer: boolean;
    aiScore: number;
    coreMeaningCorrect: boolean;
    grammarCorrect: boolean;
    toneAppropriate: boolean;
    feedbackZh: readonly string[];
    improvedAnswer: string;
  }): Result<ReviewAttemptRow> {
    return toResult(() => {
      const row = this.db
        .insert(reviewAttempts)
        .values({
          id: randomUUID(),
          taskId: input.taskId,
          userAnswer: input.userAnswer,
          usedHint: input.usedHint,
          revealedAnswer: input.revealedAnswer,
          aiScore: input.aiScore,
          coreMeaningCorrect: input.coreMeaningCorrect,
          grammarCorrect: input.grammarCorrect,
          toneAppropriate: input.toneAppropriate,
          feedbackZh: jsonEncode(input.feedbackZh),
          improvedAnswer: input.improvedAnswer,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();
      if (!row) throw new Error('复习尝试记录失败: ' + input.taskId);
      return row;
    });
  }

  /** T031 — 某任务最新一次尝试（用于展示上次反馈）。 */
  getLatestAttempt(taskId: string): Result<(ReviewAttemptRow & { feedbackZhParsed: string[] }) | null> {
    return toResult(() => {
      const row = this.db
        .select()
        .from(reviewAttempts)
        .where(eq(reviewAttempts.taskId, taskId))
        .orderBy(desc(reviewAttempts.createdAt))
        .limit(1)
        .get();
      if (!row) return null;
      return { ...row, feedbackZhParsed: parseStringArray(row.feedbackZh) };
    });
  }
}
