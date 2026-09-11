import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Audience, AnalyzeDraftResult, IssueCategory, IssueSeverity, SourceType, Tone } from '../../../shared/types/ai';
import type { Result } from '../../../shared/types/app';
import type { SqlDb } from '../db';
import { toResult } from '../errors';
import { jsonEncode, parseStringArray } from '../json';
import type { CommunicationSampleRow, DetectedIssueRow } from '../schema';
import { communicationSamples, detectedIssues } from '../schema';

export interface CreateSampleInput {
  sourceType: SourceType;
  audience: Audience;
  tone: Tone;
  /** 用户选择不保存原文时为 null */
  originalChinese: string | null;
  originalEnglish: string | null;
  /** AI 推断的用户想表达的意思（可空） */
  translationZh?: string | null;
  minimalRevision: string;
  naturalRevision: string;
  shouldClarify: boolean;
  /** 需要澄清时的问题列表（可空数组 / null） */
  clarificationQuestions: readonly string[] | null;
  keyLearningPoint?: AnalyzeDraftResult['keyLearningPoint'];
  practice?: AnalyzeDraftResult['practice'];
}

export interface DetectedIssueInput {
  category: IssueCategory;
  skillKey: string;
  originalText: string;
  correctedText: string;
  explanationZh: string;
  severity: IssueSeverity;
}

/**
 * communication_samples 表仓储（工作英语纠错样本）。
 * `saveWithIssues` 用事务保证"样本 + 其错误列表"原子落库（docs/03 核心闭环第 3-4 步）。
 */
export class CommunicationSampleRepository {
  constructor(private readonly db: SqlDb) {}

  private buildValues(id: string, input: CreateSampleInput, createdAt: string): typeof communicationSamples.$inferInsert {
    return {
      id,
      sourceType: input.sourceType,
      audience: input.audience,
      tone: input.tone,
      originalChinese: input.originalChinese,
      originalEnglish: input.originalEnglish,
      translationZh: input.translationZh ?? null,
      minimalRevision: input.minimalRevision,
      naturalRevision: input.naturalRevision,
      shouldClarify: input.shouldClarify,
      clarificationQuestions: jsonEncode(input.clarificationQuestions),
      keyLearningPoint: input.keyLearningPoint ? JSON.stringify(input.keyLearningPoint) : null,
      practice: input.practice ? JSON.stringify(input.practice) : null,
      createdAt,
    };
  }

  create(input: CreateSampleInput): Result<CommunicationSampleRow> {
    return toResult(() => {
      const row = this.db
        .insert(communicationSamples)
        .values(this.buildValues(randomUUID(), input, new Date().toISOString()))
        .returning()
        .get();
      if (!row) throw new Error('样本创建后未找到');
      return row;
    });
  }

  /** 事务写入：样本 + 关联的 detected_issues，要么都成功要么都回滚。 */
  saveWithIssues(
    input: CreateSampleInput,
    issues: readonly DetectedIssueInput[],
  ): Result<CommunicationSampleRow & { issues: DetectedIssueRow[] }> {
    return toResult(() =>
      this.db.transaction((tx) => {
        const now = new Date().toISOString();
        const sample = tx
          .insert(communicationSamples)
          .values(this.buildValues(randomUUID(), input, now))
          .returning()
          .get();
        if (!sample) throw new Error('样本创建后未找到（事务内）');

        const issueValues: typeof detectedIssues.$inferInsert[] = issues.map((issue) => ({
          id: randomUUID(),
          sampleId: sample.id,
          category: issue.category,
          skillKey: issue.skillKey,
          originalText: issue.originalText,
          correctedText: issue.correctedText,
          explanationZh: issue.explanationZh,
          severity: issue.severity,
          createdAt: now,
        }));
        const issueRows = issueValues.length > 0 ? tx.insert(detectedIssues).values(issueValues).returning().all() : [];
        return { ...sample, issues: issueRows };
      }),
    );
  }

  /** 事务删除：样本 + 其关联 detected_issues，要么都删要么都不删。返回是否实际删到（id 不存在 → false）。
   *  先 SELECT 确认存在再 DELETE（SqlDb 接口对 run() 返回类型较松，避免依赖其具体形状）。 */
  delete(id: string): Result<boolean> {
    return toResult(() =>
      this.db.transaction((tx) => {
        const found = tx
          .select({ id: communicationSamples.id })
          .from(communicationSamples)
          .where(eq(communicationSamples.id, id))
          .limit(1)
          .all();
        tx.delete(detectedIssues).where(eq(detectedIssues.sampleId, id)).run();
        tx.delete(communicationSamples).where(eq(communicationSamples.id, id)).run();
        return found.length > 0;
      }),
    );
  }

  get(id: string): Result<CommunicationSampleRow | null> {
    return toResult(
      () => this.db.select().from(communicationSamples).where(eq(communicationSamples.id, id)).get() ?? null,
    );
  }

  /** 解析澄清问题 JSON 字段后的样本（供 UI 展示澄清问题列表）。 */
  getWithQuestions(
    id: string,
  ): Result<Omit<CommunicationSampleRow, 'clarificationQuestions'> & { clarificationQuestions: string[] } | null> {
    return toResult(() => {
      const row = this.db.select().from(communicationSamples).where(eq(communicationSamples.id, id)).get();
      if (!row) return null;
      return { ...row, clarificationQuestions: parseStringArray(row.clarificationQuestions) };
    });
  }

  list(): Result<CommunicationSampleRow[]> {
    return toResult(
      () => this.db.select().from(communicationSamples).orderBy(desc(communicationSamples.createdAt)).all(),
    );
  }

  listWithIssueCounts(): Result<Array<CommunicationSampleRow & { issueCount: number }>> {
    return toResult(() => {
      const samples = this.db.select().from(communicationSamples).orderBy(desc(communicationSamples.createdAt)).all();
      return samples.map((sample) => ({
        ...sample,
        issueCount: this.db
          .select({ count: sql<number>`count(*)` })
          .from(detectedIssues)
          .where(eq(detectedIssues.sampleId, sample.id))
          .get()?.count ?? 0,
      }));
    });
  }
}
