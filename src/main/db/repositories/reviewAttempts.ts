import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import type { ReviewAttemptRow } from '../schema';
import { reviewAttempts } from '../schema';

export interface CreateAttemptInput {
  taskId: string;
  userAnswer: string;
  usedHint: boolean;
  revealedAnswer: boolean;
  aiScore?: number | null;
  coreMeaningCorrect?: boolean | null;
  grammarCorrect?: boolean | null;
  toneAppropriate?: boolean | null;
  feedbackZh?: string | null;
  improvedAnswer?: string | null;
}

/**
 * review_attempts 表仓储（一次复习尝试，docs/03 §2.6）。
 * 每次尝试都落库，历史不可覆盖（支撑"掌握度"统计与回溯）。
 */
export class ReviewAttemptRepository {
  constructor(private readonly db: SqlDb) {}

  create(input: CreateAttemptInput): Result<ReviewAttemptRow> {
    return toResult(() => {
      const row = this.db
        .insert(reviewAttempts)
        .values({
          id: randomUUID(),
          taskId: input.taskId,
          userAnswer: input.userAnswer,
          usedHint: input.usedHint,
          revealedAnswer: input.revealedAnswer,
          aiScore: input.aiScore ?? null,
          coreMeaningCorrect: input.coreMeaningCorrect ?? null,
          grammarCorrect: input.grammarCorrect ?? null,
          toneAppropriate: input.toneAppropriate ?? null,
          feedbackZh: input.feedbackZh ?? null,
          improvedAnswer: input.improvedAnswer ?? null,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();
      if (!row) throw new Error('复习尝试写入后未找到');
      return row;
    });
  }

  getByTaskId(taskId: string): Result<ReviewAttemptRow[]> {
    return toResult(
      () =>
        this.db
          .select()
          .from(reviewAttempts)
          .where(eq(reviewAttempts.taskId, taskId))
          .orderBy(desc(reviewAttempts.createdAt))
          .all(),
    );
  }

  /** 某任务最近一次尝试（用于计算 attemptIndex / 判断是否答过）。 */
  latestByTaskId(taskId: string): Result<ReviewAttemptRow | null> {
    return toResult(
      () =>
        this.db
          .select()
          .from(reviewAttempts)
          .where(eq(reviewAttempts.taskId, taskId))
          .orderBy(desc(reviewAttempts.createdAt))
          .get() ?? null,
    );
  }

  /** T033：since（ISO）之后的所有 createdAt（用于统计与趋势）。 */
  listCreatedSince(sinceIso: string): Result<string[]> {
    return toResult(
      () =>
        this.db
          .select({ createdAt: reviewAttempts.createdAt })
          .from(reviewAttempts)
          .where(gte(reviewAttempts.createdAt, sinceIso))
          .all()
          .map((r) => r.createdAt),
    );
  }

  /** T033：since（ISO）之后的独立答对次数（coreMeaningCorrect 且未用提示、未查看）。 */
  countIndependentSince(sinceIso: string): Result<number> {
    return toResult(
      () =>
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(reviewAttempts)
          .where(
            and(
              gte(reviewAttempts.createdAt, sinceIso),
              eq(reviewAttempts.coreMeaningCorrect, true),
              eq(reviewAttempts.usedHint, false),
              eq(reviewAttempts.revealedAnswer, false),
            ),
          )
          .get()?.n ?? 0,
    );
  }

  /** T033：总尝试数（判断是否有任何练习数据）。 */
  countAll(): Result<number> {
    return toResult(
      () =>
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(reviewAttempts)
          .get()?.n ?? 0,
    );
  }
}
