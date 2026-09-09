// WorkEnglish Coach — 数据管理 service（T017）
//
// 职责：
// - exportLearningData：把全部学习数据序列化为一份可读 JSON（JSON 数组字段解码为真数组）。
// - deleteAllLearningData：在一个事务里、按外键安全顺序清空 6 张学习表（保留 settings）。
//
// 设计要点（docs/02 §8、docs/06）：
// - API Key 从不写入数据库（走系统凭据存储，见 T018），因此导出/删除都天然不涉及它。
// - 本模块不 import Electron（可在纯 Node/vitest 下测试），app 元信息由调用方传入。
// - 只依赖驱动无关的 SqlDb（生产 better-sqlite3 / 测试 node:sqlite 均可注入）。
import type { Result } from '../../shared/types/app';
import type { DeleteSummary } from '../../shared/types/data';
import type { SqlDb } from '../db/db';
import { toResult } from '../db/errors';
import { parseStringArray } from '../db/json';
import {
  communicationSamples,
  detectedIssues,
  expressions,
  reviewAttempts,
  reviewTasks,
  settings,
  skills,
} from '../db/schema';
import type {
  CommunicationSampleRow,
  DetectedIssueRow,
  ExpressionRow,
  ReviewAttemptRow,
  ReviewTaskRow,
  SettingRow,
  SkillRow,
} from '../db/schema';

/** 导出文件顶层结构（format 固定，便于将来版本演进与重新导入）。 */
export interface ExportedDataset {
  format: 'wec-export/v1';
  /** ISO 8601 导出时间。 */
  exportedAt: string;
  app: { name: string; version: string };
  settings: SettingRow[];
  skills: SkillRow[];
  expressions: ExpressionRow[];
  /** clarificationQuestions 已解码为字符串数组。 */
  communicationSamples: Array<
    Omit<CommunicationSampleRow, 'clarificationQuestions'> & {
      clarificationQuestions: string[];
    }
  >;
  detectedIssues: DetectedIssueRow[];
  /** keywords / acceptableAnswers 已解码为字符串数组。 */
  reviewTasks: Array<
    Omit<ReviewTaskRow, 'keywords' | 'acceptableAnswers'> & {
      keywords: string[];
      acceptableAnswers: string[];
    }
  >;
  reviewAttempts: ReviewAttemptRow[];
}

export interface AppMeta {
  name: string;
  version: string;
}

/**
 * 读取全部表并组装为可导出的数据集。
 * 失败（如数据库未就绪 / 结构损坏）时返回统一 Result 错误，不抛异常。
 */
export function exportLearningData(
  db: SqlDb,
  meta: AppMeta,
): Result<ExportedDataset> {
  return toResult(() => {
    const mapSamples = (rows: CommunicationSampleRow[]) =>
      rows.map((r) => ({
        ...r,
        clarificationQuestions: parseStringArray(r.clarificationQuestions),
      }));
    const mapTasks = (rows: ReviewTaskRow[]) =>
      rows.map((r) => ({
        ...r,
        keywords: parseStringArray(r.keywords),
        acceptableAnswers: parseStringArray(r.acceptableAnswers),
      }));
    return {
      format: 'wec-export/v1' as const,
      exportedAt: new Date().toISOString(),
      app: { name: meta.name, version: meta.version },
      settings: db.select().from(settings).all(),
      skills: db.select().from(skills).all(),
      expressions: db.select().from(expressions).all(),
      communicationSamples: mapSamples(
        db.select().from(communicationSamples).all(),
      ),
      detectedIssues: db.select().from(detectedIssues).all(),
      reviewTasks: mapTasks(db.select().from(reviewTasks).all()),
      reviewAttempts: db.select().from(reviewAttempts).all(),
    };
  });
}

/**
 * 删除全部学习数据（保留 settings）。
 * 在单个事务内按"先子后父"的外键安全顺序执行 6 个 DELETE，
 * 事务前用 select().all().length 统计各表行数用于回执。
 */
export function deleteAllLearningData(db: SqlDb): Result<DeleteSummary> {
  return toResult(() => {
    const counts = db.transaction((tx) => {
      const before = {
        communicationSamples: tx.select().from(communicationSamples).all().length,
        detectedIssues: tx.select().from(detectedIssues).all().length,
        skills: tx.select().from(skills).all().length,
        expressions: tx.select().from(expressions).all().length,
        reviewTasks: tx.select().from(reviewTasks).all().length,
        reviewAttempts: tx.select().from(reviewAttempts).all().length,
      };
      // 先删子表，再删父表（外键约束开启时顺序必须正确）：
      //   review_attempts → review_tasks → (expressions, detected_issues) → (skills) → communication_samples
      tx.delete(reviewAttempts).run();
      tx.delete(reviewTasks).run();
      tx.delete(expressions).run();
      tx.delete(detectedIssues).run();
      tx.delete(skills).run();
      tx.delete(communicationSamples).run();
      return before;
    });
    return {
      ...counts,
      total:
        counts.communicationSamples +
        counts.detectedIssues +
        counts.skills +
        counts.expressions +
        counts.reviewTasks +
        counts.reviewAttempts,
      deletedAt: new Date().toISOString(),
    };
  });
}
