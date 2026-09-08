import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import type { ExpressionRow } from '../schema';
import { expressions } from '../schema';

export type ExpressionStatus = 'active' | 'archived';
export type MasteryStatus = 'new' | 'learning' | 'familiar';

export interface CreateExpressionInput {
  title: string;
  chineseMeaning: string;
  pattern?: string | null;
  example?: string | null;
  scenario?: string | null;
  notes?: string | null;
  sourceSampleId?: string | null;
  masteryStatus?: MasteryStatus;
  nextReviewAt?: string | null;
}

/** 可更新字段（全部可选）。`null` 表示显式清空该字段。 */
export interface UpdateExpressionInput {
  title?: string;
  chineseMeaning?: string;
  pattern?: string | null;
  example?: string | null;
  scenario?: string | null;
  notes?: string | null;
  masteryStatus?: MasteryStatus;
  nextReviewAt?: string | null;
  status?: ExpressionStatus;
}

type ExpressionInsert = typeof expressions.$inferInsert;

/**
 * expressions 表仓储（表达库）。
 * 支撑 T010（手动增删改查、归档）与 T024/T026（从样本提取、掌握度流转）。
 */
export class ExpressionRepository {
  constructor(private readonly db: SqlDb) {}

  create(input: CreateExpressionInput): Result<ExpressionRow> {
    return toResult(() => {
      const now = new Date().toISOString();
      const row = this.db
        .insert(expressions)
        .values({
          id: randomUUID(),
          title: input.title,
          chineseMeaning: input.chineseMeaning,
          pattern: input.pattern ?? null,
          example: input.example ?? null,
          scenario: input.scenario ?? null,
          notes: input.notes ?? null,
          sourceSampleId: input.sourceSampleId ?? null,
          masteryStatus: input.masteryStatus ?? 'new',
          nextReviewAt: input.nextReviewAt ?? null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      if (!row) throw new Error('表达创建后未找到');
      return row;
    });
  }

  update(id: string, patch: UpdateExpressionInput): Result<ExpressionRow> {
    return toResult(() => {
      const updates: Partial<ExpressionInsert> = { updatedAt: new Date().toISOString() };
      if (patch.title !== undefined) updates.title = patch.title;
      if (patch.chineseMeaning !== undefined) updates.chineseMeaning = patch.chineseMeaning;
      if (patch.pattern !== undefined) updates.pattern = patch.pattern;
      if (patch.example !== undefined) updates.example = patch.example;
      if (patch.scenario !== undefined) updates.scenario = patch.scenario;
      if (patch.notes !== undefined) updates.notes = patch.notes;
      if (patch.masteryStatus !== undefined) updates.masteryStatus = patch.masteryStatus;
      if (patch.nextReviewAt !== undefined) updates.nextReviewAt = patch.nextReviewAt;
      if (patch.status !== undefined) updates.status = patch.status;
      const row = this.db.update(expressions).set(updates).where(eq(expressions.id, id)).returning().get();
      if (!row) throw new Error('表达更新后未找到: ' + id);
      return row;
    });
  }

  get(id: string): Result<ExpressionRow | null> {
    return toResult(() => this.db.select().from(expressions).where(eq(expressions.id, id)).get() ?? null);
  }

  setMasteryStatus(id: string, masteryStatus: MasteryStatus): Result<ExpressionRow> {
    return this.update(id, { masteryStatus });
  }

  setStatus(id: string, status: ExpressionStatus): Result<ExpressionRow> {
    return this.update(id, { status });
  }

  list(status: ExpressionStatus = 'active', mastery?: MasteryStatus): Result<ExpressionRow[]> {
    return toResult(() => {
      const base = this.db.select().from(expressions);
      const q = mastery
        ? base.where(and(eq(expressions.status, status), eq(expressions.masteryStatus, mastery)))
        : base.where(eq(expressions.status, status));
      return q.orderBy(desc(expressions.createdAt)).all();
    });
  }

  getBySourceSampleId(sampleId: string): Result<ExpressionRow[]> {
    return toResult(() => this.db.select().from(expressions).where(eq(expressions.sourceSampleId, sampleId)).all());
  }
}
