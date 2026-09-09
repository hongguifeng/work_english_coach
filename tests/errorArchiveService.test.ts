// T027：错误档案聚合测试（按 skillKey 聚合 detected_issues + 掌握状态推导 + 错误/建议区分）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from './db/testDb';
import { createRepositories } from '../src/main/db/repositories';
import { detectedIssues, reviewAttempts } from '../src/main/db/schema';
import { buildErrorArchive } from '../src/main/services/errorArchiveService';
import {
  deriveMasteryStatus,
  outcomeFromAttempt,
} from '../src/shared/logic/mastery';

describe('mastery 推导（独立练习历史 → 掌握状态）', () => {
  const outcome = (core: boolean | null, hint: boolean, revealed: boolean) =>
    outcomeFromAttempt({ coreMeaningCorrect: core, usedHint: hint, revealedAnswer: revealed });

  it('无练习 → 新学', () => {
    expect(deriveMasteryStatus([])).toBe('new');
    expect(deriveMasteryStatus(null)).toBe('new');
  });

  it('仅失败/提示使用/查看答案 → 学习中', () => {
    expect(deriveMasteryStatus([outcome(false, true, true), outcome(false, false, false)])).toBe('learning');
    expect(deriveMasteryStatus([outcome(true, true, false)])).toBe('learning'); // 用提示
    expect(deriveMasteryStatus([outcome(true, false, true)])).toBe('learning'); // 查看答案
  });

  it('最近一次独立答对（未提示、未查看、核心意思对）→ 已熟悉', () => {
    expect(
      deriveMasteryStatus([outcome(false, true, true), outcome(true, false, false)]),
    ).toBe('familiar');
  });

  it('之后又答错 → 回落学习中（不回退到新学）', () => {
    expect(
      deriveMasteryStatus([outcome(true, false, false), outcome(false, true, true)]),
    ).toBe('learning');
  });

  it('AI 修改不算掌握：未评上（null）按答错处理', () => {
    expect(outcome(null, false, false)).toBe('wrong');
    expect(outcome(true, false, false)).toBe('correct_no_hint');
  });
});

describe('buildErrorArchive（T027）', () => {
  let db: TestDb;
  let repos: ReturnType<typeof createRepositories>;
  const s1Key = 'prep.on-time';
  const s2Key = 'vocab.ownership';
  const s3Key = 'collo.carry-out';

  beforeAll(() => {
    const d = createTestDb();
    db = d;
    repos = createRepositories(d.db);

    const sample = repos.samples.create({
      sourceType: 'instant_message',
      audience: 'manager',
      tone: 'neutral',
      originalChinese: '我会处理这个问题。',
      originalEnglish: 'I will handle it.',
      minimalRevision: 'I will handle it.',
      naturalRevision: 'I will take care of it.',
      shouldClarify: false,
      clarificationQuestions: null,
    });
    if (!sample.ok) throw sample.error;
    const sampleId = sample.data.id;

    const mk = (p: {
      skillKey: string;
      title: string;
      category: 'preposition' | 'vocabulary' | 'collocation';
      explanationZh: string;
    }) => {
      const r = repos.skills.upsert(p);
      if (!r.ok) throw r.error;
      return r.data;
    };
    const sk1 = mk({
      skillKey: s1Key,
      title: '介词 on/in 的时间用法',
      category: 'preposition',
      explanationZh: 'on Monday / in the morning',
    });
    const sk2 = mk({
      skillKey: s2Key,
      title: 'take ownership 搭配',
      category: 'vocabulary',
      explanationZh: '不能直译“所有权”',
    });
    const sk3 = mk({
      skillKey: s3Key,
      title: 'carry out 搭配建议',
      category: 'collocation',
      explanationZh: '较正式，邮件建议用 proceed with',
    });

    const issues = repos.issues.bulkCreate([
      {
        sampleId,
        category: 'preposition',
        skillKey: sk1.skillKey,
        originalText: 'I will do it in Monday.',
        correctedText: 'I will do it on Monday.',
        explanationZh: '星期用 on',
        severity: 'error',
      },
      {
        sampleId,
        category: 'preposition',
        skillKey: sk1.skillKey,
        originalText: 'I sent it in last week.',
        correctedText: 'I sent it last week.',
        explanationZh: 'last week 前不加介词',
        severity: 'error',
      },
      {
        sampleId,
        category: 'preposition',
        skillKey: sk1.skillKey,
        originalText: 'I will do it at Monday.',
        correctedText: 'I will do it on Monday.',
        explanationZh: 'at 不合适，建议 on',
        severity: 'suggestion',
      },
      {
        sampleId,
        category: 'vocabulary',
        skillKey: sk2.skillKey,
        originalText: 'I will take the ownership of it.',
        correctedText: 'I will take ownership of it.',
        explanationZh: 'ownership 前不加 the',
        severity: 'error',
      },
      {
        sampleId,
        category: 'collocation',
        skillKey: sk3.skillKey,
        originalText: 'We will carry out the plan.',
        correctedText: 'We will proceed with the plan.',
        explanationZh: '邮件场景 carry out 偏正式',
        severity: 'suggestion',
      },
    ]);
    if (!issues.ok) throw issues.error;

    // 时间轴：lastSeen 排序 s2(07-10) > s3(07-05) > s1(07-03)
    const issueTimes: [string, string][] = [
      [issues.data[0].id, '2026-07-01T10:00:00Z'],
      [issues.data[1].id, '2026-07-02T10:00:00Z'],
      [issues.data[2].id, '2026-07-03T10:00:00Z'],
      [issues.data[3].id, '2026-07-10T10:00:00Z'],
      [issues.data[4].id, '2026-07-05T10:00:00Z'],
    ];
    for (const [id, t] of issueTimes) {
      db.db
        .update(detectedIssues)
        .set({ createdAt: t })
        .where(eq(detectedIssues.id, id))
        .run();
    }

    // s1 的独立练习：先失败（用提示），后独立答对 → 最近一次=独立答对 → 已熟悉
    const t1 = repos.reviewTasks.create({
      taskType: 'correction',
      skillId: sk1.id,
      promptZh: '用 on Monday 写一句',
      context: 'chat',
      referenceAnswer: 'I will deliver it on Monday.',
      scheduledAt: '2026-07-20T00:00:00Z',
    });
    if (!t1.ok) throw t1.error;
    const a1 = repos.reviewAttempts.create({
      taskId: t1.data.id,
      userAnswer: 'I will do it in Monday.（用提示）',
      usedHint: true,
      revealedAnswer: true,
      coreMeaningCorrect: false,
      feedbackZh: '仍混淆 on/in',
    });
    const a2 = repos.reviewAttempts.create({
      taskId: t1.data.id,
      userAnswer: 'I will deliver it on Monday.（独立）',
      usedHint: false,
      revealedAnswer: false,
      coreMeaningCorrect: true,
      feedbackZh: '独立答对',
    });
    if (!(a1.ok && a2.ok)) throw new Error('attempt 写入失败');
    const [r1, r2] = [a1.data, a2.data];
    db.db
      .update(reviewAttempts)
      .set({ createdAt: '2026-07-08T09:00:00Z' })
      .where(eq(reviewAttempts.id, r1.id))
      .run();
    db.db
      .update(reviewAttempts)
      .set({ createdAt: '2026-07-09T09:00:00Z' })
      .where(eq(reviewAttempts.id, r2.id))
      .run();
  });

  afterAll(() => db.close());

  function entry(key: string) {
    const r = buildErrorArchive(repos, {});
    if (!r.ok) throw r.error;
    const found = r.data.find((e) => e.skillKey === key);
    if (!found) throw new Error('找不到档案条目: ' + key);
    return found;
  }

  it('全量：3 个条目，按最近出现倒序（s2 > s3 > s1）', () => {
    const r = buildErrorArchive(repos, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((e) => e.skillKey)).toEqual([s2Key, s3Key, s1Key]);
  });

  it('s1：2 错误 + 1 建议；最近一次独立答对 → 已熟悉', () => {
    const e = entry(s1Key);
    expect(e.count).toBe(3);
    expect(e.errorCount).toBe(2);
    expect(e.suggestionCount).toBe(1);
    expect(e.lastSeenAt).toBe('2026-07-03T10:00:00Z');
    expect(e.masteryStatus).toBe('familiar');
    expect(e.lastPracticeAt).toBe('2026-07-09T09:00:00Z');
    expect(e.lastPracticeCorrect).toBe(true);
    expect(e.examples.length).toBe(3);
    expect(e.examples[0].createdAt).toBe('2026-07-03T10:00:00Z'); // 示例倒序
  });

  it('s2：1 错误、从未练习 → 新学', () => {
    const e = entry(s2Key);
    expect(e.count).toBe(1);
    expect(e.errorCount).toBe(1);
    expect(e.masteryStatus).toBe('new');
    expect(e.lastPracticeAt).toBeNull();
  });

  it('s3：仅表达建议 → 新学，suggestion 过滤包含、error 过滤排除', () => {
    expect(entry(s3Key).masteryStatus).toBe('new');

    const rErr = buildErrorArchive(repos, { severity: 'error' });
    expect(rErr.ok).toBe(true);
    if (rErr.ok) {
      const keys = rErr.data.map((e) => e.skillKey);
      expect(keys).toContain(s1Key); // 有错误
      expect(keys).toContain(s2Key);
      expect(keys).not.toContain(s3Key); // 只有建议
    }
    const rSug = buildErrorArchive(repos, { severity: 'suggestion' });
    expect(rSug.ok).toBe(true);
    if (rSug.ok) {
      const keys = rSug.data.map((e) => e.skillKey);
      expect(keys).toContain(s1Key);
      expect(keys).toContain(s3Key);
      expect(keys).not.toContain(s2Key);
    }
  });

  it('按类别过滤：preposition 只含 s1', () => {
    const r = buildErrorArchive(repos, { category: 'preposition' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((e) => e.skillKey)).toEqual([s1Key]);
  });
});
