// WorkEnglish Coach — Drizzle schema（docs/03-data-model.md §2）
//
// 约定：
// - 列名采用 camelCase（与 docs/03 字段名一致，避免 SQLite rename 陷阱）。
// - id 统一为 TEXT 主键，由 repository 生成（crypto.randomUUID）。
// - 时间字段统一为 TEXT（ISO 8601 UTC 字符串），由 repository 写入。
// - JSON 字段（clarificationQuestions / keywords / acceptableAnswers）存 JSON 字符串，
//   由 repository 序列化/反序列化（带校验）。
// - 布尔值用 integer(0/1)（Drizzle boolean mode）。
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  type Audience,
  type IssueCategory,
  type IssueSeverity,
  type SourceType,
  type Tone,
} from '../../shared/types/ai';
import type { ReviewTaskType } from '../../shared/types/review';

/** 11 类错误分类（docs/04 §2.5.3） */
const ISSUE_CATEGORIES = [
  'grammar',
  'vocabulary',
  'collocation',
  'preposition',
  'article',
  'tense',
  'plural',
  'sentence_structure',
  'tone',
  'clarity',
  'other',
] as const satisfies readonly IssueCategory[];

const SEVERITIES = ['error', 'suggestion', 'tone_risk', 'unclear'] as const satisfies readonly IssueSeverity[];

// ---------------------------------------------------------------------------
// 2.1 communication_samples — 工作英语纠错样本
// ---------------------------------------------------------------------------
export const communicationSamples = sqliteTable('communication_samples', {
  id: text('id').primaryKey(),
  sourceType: text('sourceType', { enum: ['email', 'instant_message', 'meeting', 'report'] }).$type<SourceType>().notNull(),
  audience: text('audience', { enum: ['colleague', 'manager', 'client', 'supplier', 'other'] })
    .$type<Audience>()
    .notNull(),
  tone: text('tone', { enum: ['neutral', 'formal', 'friendly', 'firm'] }).$type<Tone>().notNull(),
  /** 用户选择不保存原文时为 NULL */
  originalChinese: text('originalChinese'),
  originalEnglish: text('originalEnglish'),
  minimalRevision: text('minimalRevision').notNull(),
  naturalRevision: text('naturalRevision').notNull(),
  shouldClarify: integer('shouldClarify', { mode: 'boolean' }).notNull().default(false),
  /** JSON 数组字符串 */
  clarificationQuestions: text('clarificationQuestions'),
  createdAt: text('createdAt').notNull(),
});

// ---------------------------------------------------------------------------
// 2.2 detected_issues — 具体错误（错误档案 = detected_issues + skills）
// ---------------------------------------------------------------------------
export const detectedIssues = sqliteTable(
  'detected_issues',
  {
    id: text('id').primaryKey(),
    sampleId: text('sampleId')
      .notNull()
      .references(() => communicationSamples.id),
    category: text('category', { enum: ISSUE_CATEGORIES }).$type<IssueCategory>().notNull(),
    /** 指向知识点（skills.skillKey） */
    skillKey: text('skillKey').notNull(),
    originalText: text('originalText').notNull(),
    correctedText: text('correctedText').notNull(),
    explanationZh: text('explanationZh').notNull(),
    severity: text('severity', { enum: SEVERITIES }).$type<IssueSeverity>().notNull(),
    createdAt: text('createdAt').notNull(),
  },
  (t) => [index('idx_issues_sample').on(t.sampleId)],
);

// ---------------------------------------------------------------------------
// 2.3 skills — 知识点主表（skillKey 唯一）
// ---------------------------------------------------------------------------
export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    skillKey: text('skillKey').notNull().unique(),
    title: text('title').notNull(),
    category: text('category', { enum: ISSUE_CATEGORIES }).$type<IssueCategory>().notNull(),
    explanationZh: text('explanationZh').notNull(),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  (t) => [index('idx_skills_category').on(t.category)],
);

// ---------------------------------------------------------------------------
// 2.4 expressions — 表达库
// masteryStatus: new / learning / familiar（docs/03 §2.4）
// status: 产品扩展（档案/使用中），docs/03 未列；支撑 T010 的归档交互
// ---------------------------------------------------------------------------
export const expressions = sqliteTable(
  'expressions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    chineseMeaning: text('chineseMeaning').notNull(),
    pattern: text('pattern'),
    example: text('example'),
    scenario: text('scenario'),
    notes: text('notes'),
    /** 来源样本（可空：手动添加时为空） */
    sourceSampleId: text('sourceSampleId').references(() => communicationSamples.id),
    masteryStatus: text('masteryStatus', { enum: ['new', 'learning', 'familiar'] })
      .$type<'new' | 'learning' | 'familiar'>()
      .notNull()
      .default('new'),
    /** ISO 日期字符串（下次复习时间） */
    nextReviewAt: text('nextReviewAt'),
    status: text('status', { enum: ['active', 'archived'] })
      .$type<'active' | 'archived'>()
      .notNull()
      .default('active'),
    createdAt: text('createdAt').notNull(),
    updatedAt: text('updatedAt').notNull(),
  },
  (t) => [index('idx_expressions_mastery').on(t.masteryStatus), index('idx_expressions_status').on(t.status)],
);

// ---------------------------------------------------------------------------
// 2.5 review_tasks — 复习任务
// ---------------------------------------------------------------------------
export const reviewTasks = sqliteTable(
  'review_tasks',
  {
    id: text('id').primaryKey(),
    taskType: text('taskType').$type<ReviewTaskType>().notNull(),
    skillId: text('skillId').references(() => skills.id),
    expressionId: text('expressionId').references(() => expressions.id),
    promptZh: text('promptZh').notNull(),
    context: text('context'),
    /** JSON 数组字符串 */
    keywords: text('keywords'),
    referenceAnswer: text('referenceAnswer').notNull(),
    /** JSON 数组字符串（可空） */
    acceptableAnswers: text('acceptableAnswers'),
    status: text('status', { enum: ['pending', 'completed', 'skipped'] })
      .$type<'pending' | 'completed' | 'skipped'>()
      .notNull()
      .default('pending'),
    /** ISO 日期字符串 */
    scheduledAt: text('scheduledAt').notNull(),
    completedAt: text('completedAt'),
    createdAt: text('createdAt').notNull(),
  },
  (t) => [index('idx_review_status_scheduled').on(t.status, t.scheduledAt)],
);

// ---------------------------------------------------------------------------
// 2.6 review_attempts — 一次复习尝试
// ---------------------------------------------------------------------------
export const reviewAttempts = sqliteTable(
  'review_attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('taskId')
      .notNull()
      .references(() => reviewTasks.id),
    userAnswer: text('userAnswer').notNull(),
    usedHint: integer('usedHint', { mode: 'boolean' }).notNull().default(false),
    revealedAnswer: integer('revealedAnswer', { mode: 'boolean' }).notNull().default(false),
    aiScore: integer('aiScore'),
    coreMeaningCorrect: integer('coreMeaningCorrect', { mode: 'boolean' }),
    grammarCorrect: integer('grammarCorrect', { mode: 'boolean' }),
    toneAppropriate: integer('toneAppropriate', { mode: 'boolean' }),
    feedbackZh: text('feedbackZh'),
    improvedAnswer: text('improvedAnswer'),
    createdAt: text('createdAt').notNull(),
  },
  (t) => [index('idx_attempts_task').on(t.taskId)],
);

// ---------------------------------------------------------------------------
// 2.7 settings — key/value 设置表
// 注意：API Key 不存这里（docs/03 §2.7），走 Windows 凭据存储（T018）。
// ---------------------------------------------------------------------------
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

// ---------------------------------------------------------------------------
// 行类型（供 repository / IPC 使用）
// ---------------------------------------------------------------------------
export type CommunicationSampleRow = typeof communicationSamples.$inferSelect;
export type DetectedIssueRow = typeof detectedIssues.$inferSelect;
export type SkillRow = typeof skills.$inferSelect;
export type ExpressionRow = typeof expressions.$inferSelect;
export type ReviewTaskRow = typeof reviewTasks.$inferSelect;
export type ReviewAttemptRow = typeof reviewAttempts.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
