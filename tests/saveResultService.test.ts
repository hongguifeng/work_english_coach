// T025: 保存纠错结果服务测试
//
// 覆盖 docs/08 T025 全部子项：
//   - 保存 communication_sample（含/不含原文两种分支）
//   - 保存 detected_issues（原子写入，条数与 payload 一致）
//   - 去重或复用已有 skill（同 skillKey 重复保存 → 单行，标题被更新）
//   - 根据设置决定是否保存原文（saveOriginal=false → 原文 NULL，知识点仍可用于复习）
//   - 支持保存表达（masteryStatus=new、关联样本；saveExpression=false → 不建）
//   - 重点知识点分类推导（取最严重问题；无问题 → other）
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../src/main/db/repositories';
import { saveCorrectionResult } from '../src/main/services/saveResultService';
import type {
  AnalyzeDraftInput,
  AnalyzeDraftResult,
  AnalysisIssue,
} from '../src/shared/types/ai';
import { createTestDb } from './db/testDb';

const INPUT: AnalyzeDraftInput = {
  originalChinese: '告诉供应商：报告会推迟到明天下午',
  originalEnglish: 'We will delay the report to tomorrow morning.',
  sourceType: 'email',
  audience: 'supplier',
  tone: 'formal',
};

function makeIssue(overrides: Partial<AnalysisIssue> = {}): AnalysisIssue {
  return {
    category: 'tense',
    skillKey: 'tense:will-vs-going-to',
    originalText: 'will delay',
    correctedText: 'will be delayed',
    explanationZh: 'will 用于临时决定，此处用 be delayed 更自然。',
    severity: 'error',
    ...overrides,
  };
}

function makeResult(overrides: Partial<AnalyzeDraftResult> = {}): AnalyzeDraftResult {
  return {
    minimalRevision: 'We will delay the report to tomorrow afternoon.',
    naturalRevision: 'Please note that the report will be delivered tomorrow afternoon instead.',
    shouldClarify: false,
    clarificationQuestions: [],
    issues: [
      makeIssue(),
      makeIssue({
        category: 'grammar',
        skillKey: 'grammar:passive-voice',
        originalText: 'delay',
        correctedText: 'be delivered',
        explanationZh: '被动语态更正式。',
        severity: 'suggestion',
      }),
    ],
    keyLearningPoint: {
      skillKey: 'tense:will-vs-going-to',
      title: 'will vs going to',
      explanationZh: 'will 表临时决定，going to 表计划。',
    },
    practice: {
      instructionZh: '用 will 或 be going to 改写本句。',
      context: 'Tell the supplier the report will arrive tomorrow afternoon.',
      referenceAnswer: 'The report will be delivered tomorrow afternoon.',
      keywords: ['will', 'delivered', 'tomorrow afternoon'],
    },
    ...overrides,
  };
}

describe('saveCorrectionResult (T025)', () => {
  it('saveOriginal=true + saveExpression=true：样本/错误/知识点/表达全部落库', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const summary = result.data;
      expect(summary.savedOriginal).toBe(true);
      expect(summary.issueCount).toBe(2);
      expect(summary.skillKey).toBe('tense:will-vs-going-to');
      expect(typeof summary.expressionId).toBe('string');

      // 样本：原文已保存
      const samples = client
        .prepare('SELECT * FROM communication_samples')
        .all() as Array<Record<string, unknown>>;
      expect(samples).toHaveLength(1);
      expect(samples[0]?.id).toBe(summary.sampleId);
      expect(samples[0]?.originalChinese).toBe(INPUT.originalChinese);
      expect(samples[0]?.originalEnglish).toBe(INPUT.originalEnglish);

      // 错误列表：2 条，均关联样本
      const issues = client
        .prepare('SELECT * FROM detected_issues ORDER BY skillKey')
        .all() as Array<Record<string, unknown>>;
      expect(issues).toHaveLength(2);
      expect(issues.every((i) => i.sampleId === summary.sampleId)).toBe(true);
      expect(issues.map((i) => i.severity)).toEqual(['suggestion', 'error']); // 按 skillKey 排序：grammar 在 tense 前

      // 知识点：2 条 = keyLearningPoint + 其余错误知识点（②-b 补建，分类取最严重问题 = tense/error）
      const skills = client.prepare('SELECT * FROM skills').all() as Array<Record<string, unknown>>;
      expect(skills).toHaveLength(2);
      expect(skills[0]?.skillKey).toBe('tense:will-vs-going-to');
      expect(skills[0]?.category).toBe('tense');
      expect(skills[1]?.skillKey).toBe('grammar:passive-voice');
      expect(skills[1]?.title).toBe('be delivered'); // 标题取修改后表达
      expect(skills[1]?.category).toBe('grammar');

      // 表达：masteryStatus=new，关联样本，example=自然表达版
      const exprs = client.prepare('SELECT * FROM expressions').all() as Array<Record<string, unknown>>;
      expect(exprs).toHaveLength(1);
      expect(exprs[0]?.id).toBe(summary.expressionId);
      expect(exprs[0]?.sourceSampleId).toBe(summary.sampleId);
      expect(exprs[0]?.masteryStatus).toBe('new');
      expect(exprs[0]?.example).toBe(makeResult().naturalRevision);
      expect(exprs[0]?.scenario).toBe('email');
      expect(exprs[0]?.chineseMeaning).toBe(INPUT.originalChinese);
      expect(exprs[0]?.notes).toBe('supplier / formal');
    } finally {
      close();
    }
  });

  it('把 AI 推断的「你想表达的意思」(translationZh) 持久化到样本；未提供时存 NULL', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const withZh = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult({ translationZh: '告诉供应商：报告会在周五之前提交。' }),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(withZh.ok).toBe(true);
      if (!withZh.ok) return;
      const r1 = client
        .prepare('SELECT translationZh FROM communication_samples WHERE id = ?')
        .get(withZh.data.sampleId) as Record<string, unknown> | undefined;
      expect(r1?.translationZh).toBe('告诉供应商：报告会在周五之前提交。');

      const withoutZh = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(withoutZh.ok).toBe(true);
      if (!withoutZh.ok) return;
      const r2 = client
        .prepare('SELECT translationZh FROM communication_samples WHERE id = ?')
        .get(withoutZh.data.sampleId) as Record<string, unknown> | undefined;
      expect(r2?.translationZh).toBeNull();
    } finally {
      close();
    }
  });

  it('saveOriginal=false：原文 NULL，但知识点/错误/表达仍可复习（chineseMeaning 为空串）', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: false,
        saveExpression: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const sample = client
        .prepare('SELECT * FROM communication_samples')
        .get() as Record<string, unknown>;
      expect(sample.originalChinese).toBeNull();
      expect(sample.originalEnglish).toBeNull();
      // 修改版仍然保留（AI 输出不是用户原文，隐私要求只针对原文）
      expect(typeof sample.minimalRevision).toBe('string');
      expect(typeof sample.naturalRevision).toBe('string');

      // 知识点仍然落库 → 可复习
      const skill = client.prepare('SELECT * FROM skills').get() as Record<string, unknown>;
      expect(skill.skillKey).toBe('tense:will-vs-going-to');

      // 表达：chineseMeaning 为空串（非 NULL，满足 notNull 约束），不泄漏中文原文
      const expr = client.prepare('SELECT * FROM expressions').get() as Record<string, unknown>;
      expect(expr.chineseMeaning).toBe('');
      expect(expr.example).toBe(makeResult().naturalRevision);
    } finally {
      close();
    }
  });

  it('saveExpression=false：不建表达，但样本/错误/知识点照存', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.expressionId).toBeNull();
      expect(client.prepare('SELECT COUNT(*) AS n FROM expressions').get()).toMatchObject({ n: 0 });
      expect(client.prepare('SELECT COUNT(*) AS n FROM communication_samples').get()).toMatchObject({ n: 1 });
      expect(client.prepare('SELECT COUNT(*) AS n FROM detected_issues').get()).toMatchObject({ n: 2 });
      expect(client.prepare('SELECT COUNT(*) AS n FROM skills').get()).toMatchObject({ n: 2 }); // KLP + ②-b 补建
    } finally {
      close();
    }
  });

  it('复用 sampleId：确认保存不重复创建历史记录，并保留重点与训练提示', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const first = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const confirmed = saveCorrectionResult(repos, {
        sampleId: first.data.sampleId,
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: true,
      });
      expect(confirmed.ok).toBe(true);
      expect(confirmed.ok && confirmed.data.sampleId).toBe(first.data.sampleId);
      expect(client.prepare('SELECT COUNT(*) AS n FROM communication_samples').get()).toMatchObject({ n: 1 });
      const sample = client.prepare('SELECT keyLearningPoint, practice FROM communication_samples').get() as Record<string, string>;
      expect(JSON.parse(sample.keyLearningPoint).title).toBe('will vs going to');
      expect(JSON.parse(sample.practice).keywords).toEqual(['will', 'delivered', 'tomorrow afternoon']);
    } finally {
      close();
    }
  });

  it('skill 去重复用：同 skillKey 二次保存 → KLP 单行且标题更新；②-b 已有行不重建', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const first = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(first.ok).toBe(true);

      const second = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult({
          keyLearningPoint: {
            skillKey: 'tense:will-vs-going-to',
            title: 'will vs going to（更新版）',
            explanationZh: '第二次分析补充说明。',
          },
        }),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(second.ok).toBe(true);

      const skills = client.prepare('SELECT * FROM skills').all() as Array<Record<string, unknown>>;
      expect(skills).toHaveLength(2); // KLP + ②-b 行（二次保存未重复创建）
      const klp = skills.find((s) => s.skillKey === 'tense:will-vs-going-to');
      expect(klp?.title).toBe('will vs going to（更新版）');
      // 样本不受去重影响
      expect(client.prepare('SELECT COUNT(*) AS n FROM communication_samples').get()).toMatchObject({ n: 2 });
    } finally {
      close();
    }
  });

  it('②-b 已有 skills 行不被覆盖：非 KLP 的 skillKey 之前已是 KLP 时保留原标题/说明', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      // 预置：grammar:passive-voice 之前作为 keyLearningPoint 写入（标题更完整）
      const seeded = repos.skills.upsert({
        skillKey: 'grammar:passive-voice',
        title: '被动语态（完整说明版）',
        category: 'grammar',
        explanationZh: '正式场合优先被动语态。',
      });
      expect(seeded.ok).toBe(true);

      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult(), // KLP=tense:will-vs-going-to；issues 含 grammar:passive-voice
        saveOriginal: true,
        saveExpression: false,
      });
      expect(result.ok).toBe(true);

      const row = client
        .prepare('SELECT * FROM skills WHERE skillKey = ?')
        .get('grammar:passive-voice') as Record<string, unknown>;
      expect(row.title).toBe('被动语态（完整说明版）'); // 未被 issue 的 correctedText 覆盖
      expect(row.explanationZh).toBe('正式场合优先被动语态。');
      expect(client.prepare('SELECT COUNT(*) AS n FROM skills').get()).toMatchObject({ n: 2 });
    } finally {
      close();
    }
  });

  it('分类推导：取最严重问题的分类（suggestion 先、tone_risk 后 → tone）', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult({
          issues: [
            makeIssue({
              category: 'grammar',
              skillKey: 'grammar:passive-voice',
              severity: 'suggestion',
            }),
            makeIssue({
              category: 'tone',
              skillKey: 'tone:politeness',
              severity: 'tone_risk',
            }),
          ],
        }),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(result.ok).toBe(true);

      const skill = client.prepare('SELECT * FROM skills').get() as Record<string, unknown>;
      expect(skill.category).toBe('tone');
    } finally {
      close();
    }
  });

  it('无错误列表：分类回退 other，样本仍可保存（零错误样本）', () => {
    const { db, client, close } = createTestDb();
    try {
      const repos = createRepositories(db);
      const result = saveCorrectionResult(repos, {
        input: INPUT,
        result: makeResult({ issues: [] }),
        saveOriginal: true,
        saveExpression: false,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.issueCount).toBe(0);
      expect(client.prepare('SELECT COUNT(*) AS n FROM detected_issues').get()).toMatchObject({ n: 0 });
      const skill = client.prepare('SELECT * FROM skills').get() as Record<string, unknown>;
      expect(skill.category).toBe('other');
    } finally {
      close();
    }
  });
});
