import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { IssueCategory } from '../../../shared/types/ai';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import type { SkillRow } from '../schema';
import { skills } from '../schema';

/** 知识点 upsert 入参（skillKey 唯一）。 */
export interface UpsertSkillInput {
  skillKey: string;
  title: string;
  category: IssueCategory;
  explanationZh: string;
}

/**
 * skills 表仓储（知识点主表，skillKey 唯一）。
 * upsert 语义：同一 skillKey 的知识点只保留一条，重复分析时更新而非重复插入。
 */
export class SkillRepository {
  constructor(private readonly db: SqlDb) {}

  upsert(input: UpsertSkillInput): Result<SkillRow> {
    return toResult(() => {
      const now = new Date().toISOString();
      this.db
        .insert(skills)
        .values({
          id: randomUUID(),
          skillKey: input.skillKey,
          title: input.title,
          category: input.category,
          explanationZh: input.explanationZh,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: skills.skillKey,
          set: {
            title: input.title,
            category: input.category,
            explanationZh: input.explanationZh,
            updatedAt: now,
          },
        })
        .run();
      const row = this.db.select().from(skills).where(eq(skills.skillKey, input.skillKey)).get();
      if (!row) throw new Error('知识点写入后未找到: ' + input.skillKey);
      return row;
    });
  }

  getByKey(skillKey: string): Result<SkillRow | null> {
    return toResult(() => this.db.select().from(skills).where(eq(skills.skillKey, skillKey)).get() ?? null);
  }

  /** 按主键 id 查询（T028 复习任务生成用）。 */
  getById(id: string): Result<SkillRow | null> {
    return toResult(() => this.db.select().from(skills).where(eq(skills.id, id)).get() ?? null);
  }

  list(category?: IssueCategory): Result<SkillRow[]> {
    return toResult(() => {
      const base = this.db.select().from(skills);
      const q = category ? base.where(eq(skills.category, category)) : base;
      return q.orderBy(asc(skills.createdAt)).all();
    });
  }
}
