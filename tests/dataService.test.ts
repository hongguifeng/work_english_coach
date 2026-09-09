// T017：数据导出与删除服务测试
//
// 覆盖 docs/08 T017 核心：
//   - 导出全部 7 张表，JSON 字段被解码为真正的数组
//   - 导出结果可解析为合法 JSON（可被 File System Access API 写入文件）
//   - 导出结构性地不含 API Key（数据库里没有它）
//   - 删除 6 张学习表、保留 settings
//   - 删除后各表为空，且返回准确的行数统计
//
// 直接对 schema 插入（而非 repository）以验证 dataService 的批量查询/事务删除逻辑。
import { describe, expect, it } from 'vitest';
import * as schema from '../src/main/db/schema';
import {
  deleteAllLearningData,
  exportLearningData,
} from '../src/main/services/dataService';
import { createTestDb } from './db/testDb';

const APP_META = { name: 'WorkEnglish Coach', version: '0.1.0' };
const NOW = '2026-07-25T12:00:00.000Z';

function seed(db: ReturnType<typeof createTestDb>['db']): void {
  const s = crypto.randomUUID();
  const i = crypto.randomUUID();
  const k = crypto.randomUUID();
  const e = crypto.randomUUID();
  const t = crypto.randomUUID();
  const a = crypto.randomUUID();

  db.insert(schema.communicationSamples)
    .values({
      id: s,
      sourceType: 'email',
      audience: 'supplier',
      tone: 'formal',
      originalChinese: '提醒供应商周五前确认',
      originalEnglish: 'We need confirm before Friday.',
      minimalRevision: 'We need to confirm it before Friday.',
      naturalRevision: 'We need to confirm with the supplier before Friday.',
      shouldClarify: true,
      clarificationQuestions: '["Is Friday the 25th?"]',
      createdAt: NOW,
    })
    .run();

  db.insert(schema.detectedIssues)
    .values({
      id: i,
      sampleId: s,
      category: 'grammar',
      skillKey: 'need+to',
      originalText: 'We need confirm',
      correctedText: 'We need to confirm',
      explanationZh: 'need 后必须接 to + 动词',
      severity: 'error',
      createdAt: NOW,
    })
    .run();

  db.insert(schema.skills)
    .values({
      id: k,
      skillKey: 'need+to',
      title: 'need + to do',
      category: 'grammar',
      explanationZh: 'need 后必须接 to + 动词',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();

  db.insert(schema.expressions)
    .values({
      id: e,
      title: 'confirm by <date>',
      chineseMeaning: '在某日期前确认',
      pattern: 'Could you confirm by <date>?',
      example: 'Could you confirm by Friday?',
      sourceSampleId: s,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();

  db.insert(schema.reviewTasks)
    .values({
      id: t,
      taskType: 'rewrite',
      skillId: k,
      expressionId: e,
      promptZh: '周五前和供应商确认',
      keywords: '["confirm","by Friday"]',
      referenceAnswer: 'We need to confirm with the supplier before Friday.',
      acceptableAnswers: '["Could you confirm by Friday?"]',
      scheduledAt: '2026-07-26',
      createdAt: NOW,
    })
    .run();

  db.insert(schema.reviewAttempts)
    .values({
      id: a,
      taskId: t,
      userAnswer: 'We need to confirm with the supplier before Friday.',
      coreMeaningCorrect: true,
      grammarCorrect: true,
      toneAppropriate: true,
      feedbackZh: 'good',
      createdAt: NOW,
    })
    .run();

  db.insert(schema.settings)
    .values({ key: 'save_original', value: 'true', updatedAt: NOW })
    .run();
}

describe('T017 dataService.exportLearningData', () => {
  it('导出全部 7 张表，JSON 字段被解码为真正的数组', () => {
    const { db } = createTestDb();
    seed(db);

    const result = exportLearningData(db, APP_META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data;
    expect(data.app.name).toBe('WorkEnglish Coach');
    expect(data.app.version).toBe('0.1.0');
    expect(typeof data.exportedAt).toBe('string');

    expect(data.communicationSamples).toHaveLength(1);
    expect(data.detectedIssues).toHaveLength(1);
    expect(data.skills).toHaveLength(1);
    expect(data.expressions).toHaveLength(1);
    expect(data.reviewTasks).toHaveLength(1);
    expect(data.reviewAttempts).toHaveLength(1);
    expect(data.settings).toHaveLength(1);

    // JSON 数组字段被解码
    const sample = data.communicationSamples[0]!;
    const task = data.reviewTasks[0]!;
    const skill = data.skills[0]!;
    const setting = data.settings[0]!;
    expect(sample.clarificationQuestions).toStrictEqual(['Is Friday the 25th?']);
    expect(task.keywords).toStrictEqual(['confirm', 'by Friday']);
    expect(task.acceptableAnswers).toStrictEqual(['Could you confirm by Friday?']);

    // 普通字段透传
    expect(skill.category).toBe('grammar');
    expect(setting.value).toBe('true');
  });

  it('导出结果是合法 JSON（可写入文件）且不含 API Key', () => {
    const { db } = createTestDb();
    seed(db);

    const result = exportLearningData(db, APP_META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = JSON.stringify(result.data);
    // 可被重新解析（等价于 File System Access API 写入后的文件内容）
    const reparsed: unknown = JSON.parse(json);
    expect(reparsed).toBeTruthy();

    // API Key 绝不出现在导出内容中（数据库里根本不存它）
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(json.toLowerCase()).not.toContain('api key');
  });
});

describe('T017 dataService.deleteAllLearningData', () => {
  it('删除 6 张学习表并返回准确行数，保留 settings', () => {
    const { db } = createTestDb();
    seed(db);

    const result = deleteAllLearningData(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = result.data;
    // 每张学习表各 1 行 → 总计 6
    expect(summary.total).toBe(6);
    expect(summary.communicationSamples).toBe(1);
    expect(summary.detectedIssues).toBe(1);
    expect(summary.skills).toBe(1);
    expect(summary.expressions).toBe(1);
    expect(summary.reviewTasks).toBe(1);
    expect(summary.reviewAttempts).toBe(1);
    expect(typeof summary.deletedAt).toBe('string');

    // 6 张学习表清空
    expect(db.select().from(schema.communicationSamples).all()).toHaveLength(0);
    expect(db.select().from(schema.detectedIssues).all()).toHaveLength(0);
    expect(db.select().from(schema.skills).all()).toHaveLength(0);
    expect(db.select().from(schema.expressions).all()).toHaveLength(0);
    expect(db.select().from(schema.reviewTasks).all()).toHaveLength(0);
    expect(db.select().from(schema.reviewAttempts).all()).toHaveLength(0);

    // settings 保留
    expect(db.select().from(schema.settings).all()).toHaveLength(1);
  });

  it('空库删除返回全 0（不抛错）', () => {
    const { db } = createTestDb();
    const result = deleteAllLearningData(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(0);
    expect(result.data.communicationSamples).toBe(0);
  });
});
