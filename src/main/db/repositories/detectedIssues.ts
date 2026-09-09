import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { IssueCategory, IssueSeverity } from '../../../shared/types/ai';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import type { DetectedIssueRow } from '../schema';
import { detectedIssues } from '../schema';

export interface CreateIssueInput {
  sampleId: string;
  category: IssueCategory;
  skillKey: string;
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
}

/**
 * detected_issues 表仓储（具体错误）。
 * "错误档案"= detected_issues 按 skillKey 归类 + skills 知识点（docs/03 §2.2）。
 */
export class DetectedIssueRepository {
  constructor(private readonly db: SqlDb) {}

  create(input: CreateIssueInput): Result<DetectedIssueRow> {
    return toResult(() => {
      const row = this.db
        .insert(detectedIssues)
        .values({ ...input, id: randomUUID(), createdAt: new Date().toISOString() })
        .returning()
        .get();
      if (!row) throw new Error('错误写入后未找到');
      return row;
    });
  }

  bulkCreate(inputs: readonly CreateIssueInput[]): Result<DetectedIssueRow[]> {
    return toResult(() => {
      if (inputs.length === 0) return [];
      const now = new Date().toISOString();
      return this.db
        .insert(detectedIssues)
        .values(inputs.map((i) => ({ ...i, id: randomUUID(), createdAt: now })))
        .returning()
        .all();
    });
  }

  getBySampleId(sampleId: string): Result<DetectedIssueRow[]> {
    return toResult(() => this.db.select().from(detectedIssues).where(eq(detectedIssues.sampleId, sampleId)).all());
  }

  list(limit = 200): Result<DetectedIssueRow[]> {
    return toResult(
      () => this.db.select().from(detectedIssues).orderBy(desc(detectedIssues.createdAt)).limit(limit).all(),
    );
  }

  /** 全部错误（无上限，按时间倒序；错误档案聚合用，T027） */
  listAll(): Result<DetectedIssueRow[]> {
    return toResult(
      () => this.db.select().from(detectedIssues).orderBy(desc(detectedIssues.createdAt)).all(),
    );
  }
}
