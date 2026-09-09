// T033 — 学习统计 service 单元测试（基于 :memory: DB + 真实 repositories）
//
// 覆盖 docs/08 T033 核心口径：
// - 本周练习次数 = 本周（周一 0:00 起）review_attempts 数量（AI 自动修改不算掌握）
// - 独立完成 = coreMeaningCorrect && !usedHint && !revealedAnswer
// - 待复习任务 = review_tasks.status='pending'
// - 高频错误 = detected_issues 按 skillKey 分组 top N
// - 近七天趋势按本地日期分桶
// - hasAnyData 边界
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './db/testDb';
import type { TestDb } from './db/testDb';
import { createRepositories } from '../src/main/db/repositories';
import { getStudyStats } from '../src/main/services/studyStatsService';

// 固定“今天”：2026-07-19（周六）12:00（本地）
const NOW = new Date(2026, 6, 19, 12, 0, 0);

function run(tdb: TestDb, sql: string, params: unknown[] = []): void {
  tdb.client.prepare(sql).run(...(params as []));
}

function seedSample(tdb: TestDb, id: string): void {
  run(
    tdb,
    `INSERT INTO communication_samples
       (id, sourceType, audience, tone, minimalRevision, naturalRevision, createdAt)
     VALUES (?, 'email', 'colleague', 'neutral', 'min', 'nat', ?)`,
    [id, '2026-07-01T00:00:00.000Z'],
  );
}

function seedIssue(tdb: TestDb, sampleId: string, skillKey: string, at: string): void {
  run(
    tdb,
    `INSERT INTO detected_issues
       (id, sampleId, category, skillKey, originalText, correctedText, explanationZh, severity, createdAt)
     VALUES (?, ?, 'grammar', ?, 'bad', 'good', '说明', 'error', ?)`,
    [`iss-${sampleId}-${skillKey}-${at}`, sampleId, skillKey, at],
  );
}

function seedTask(tdb: TestDb, id: string, status: 'pending' | 'completed' | 'skipped'): void {
  run(
    tdb,
    `INSERT INTO review_tasks
       (id, taskType, promptZh, referenceAnswer, status, scheduledAt, completedAt, createdAt)
     VALUES (?, 'rewrite', 'p', 'ref', ?, ?, ?, '2026-07-01T00:00:00.000Z')`,
    [id, status, '2026-07-13T00:00:00.000Z', status === 'pending' ? null : '2026-07-15T00:00:00.000Z'],
  );
}

function seedAttempt(
  tdb: TestDb,
  taskId: string,
  at: string,
  core: null | boolean,
  usedHint = false,
  revealed = false,
): void {
  run(
    tdb,
    `INSERT INTO review_attempts
       (id, taskId, userAnswer, usedHint, revealedAnswer, coreMeaningCorrect, grammarCorrect, toneAppropriate, createdAt)
     VALUES (?, ?, 'answer', ?, ?, ?, ?, ?, ?)`,
    [
      `att-${taskId}-${at}`,
      taskId,
      usedHint ? 1 : 0,
      revealed ? 1 : 0,
      core === null ? null : core ? 1 : 0,
      1,
      1,
      at,
    ],
  );
}

describe('studyStatsService', () => {
  let tdb: TestDb;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    tdb = createTestDb();
    repos = createRepositories(tdb.db);
  });

  it('empty DB → hasAnyData=false, 全零统计', () => {
    const r = getStudyStats(repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.hasAnyData).toBe(false);
    expect(r.data.weekPracticeCount).toBe(0);
    expect(r.data.independentCount).toBe(0);
    expect(r.data.pendingTaskCount).toBe(0);
    expect(r.data.topErrors).toEqual([]);
    expect(r.data.trend).toHaveLength(7);
    expect(r.data.trend.every((p) => p.count === 0)).toBe(true);
  });

  it('按 docs/08 口径统计本周练习/独立完成/待复习/高频错误/趋势', () => {
    // sample + 高频错误：tense×3（其中 1 条在本周之外，也应计数）、articles×2、collocation×1
    seedSample(tdb, 's1');
    seedIssue(tdb, 's1', 'tense', '2026-07-15T01:00:00.000Z');
    seedIssue(tdb, 's1', 'tense', '2026-07-16T01:00:00.000Z');
    seedIssue(tdb, 's1', 'tense', '2026-07-05T01:00:00.000Z'); // 早于本周
    seedIssue(tdb, 's1', 'articles', '2026-07-15T02:00:00.000Z');
    seedIssue(tdb, 's1', 'articles', '2026-07-16T02:00:00.000Z');
    seedIssue(tdb, 's1', 'collocation', '2026-07-15T03:00:00.000Z');

    // 复习任务：1 pending + 1 completed（pending 计数应为 1）
    seedTask(tdb, 't1', 'pending');
    seedTask(tdb, 't2', 'completed');

    // 练习：
    // A 07-15（本周内）core=null → 计入练习，不算独立
    // B 07-16（本周内）core=true 无提示 → 计入独立
    // C 07-10（本周外）core=true → 不计入本周练习
    seedAttempt(tdb, 't2', '2026-07-15T01:30:00.000Z', null);
    seedAttempt(tdb, 't2', '2026-07-16T02:30:00.000Z', true);
    seedAttempt(tdb, 't2', '2026-07-10T03:30:00.000Z', true);

    const r = getStudyStats(repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;

    expect(d.weekPracticeCount).toBe(2); // A + B
    expect(d.independentCount).toBe(1); // B
    expect(d.pendingTaskCount).toBe(1); // t1
    expect(d.topErrors).toEqual([
      { key: 'tense', count: 3 },
      { key: 'articles', count: 2 },
      { key: 'collocation', count: 1 },
    ]);
    // 近七天 = 07-13..07-19（本地）；A/B 用 UTC 时间戳，
    // 在 ±12h 时区偏移下仍落在窗口内（具体桶位置随时区移动，
    // 故只断言总数、首桶为零与每桶 ≤1）
    expect(d.trend.map((p) => p.date)).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
    expect(d.trend[0]!.count).toBe(0);
    expect(d.trend.every((p) => p.count <= 1)).toBe(true);
    expect(d.trend.reduce((s, p) => s + p.count, 0)).toBe(2); // C 在窗口外
    expect(d.hasAnyData).toBe(true);
  });

  it('只有待复习任务（无练习/错误）时 hasAnyData=true', () => {
    seedTask(tdb, 't1', 'pending');
    const r = getStudyStats(repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.hasAnyData).toBe(true);
    expect(r.data.pendingTaskCount).toBe(1);
    expect(r.data.weekPracticeCount).toBe(0);
  });

  it('只统计 top 5 高频错误（第 6 名被裁掉）', () => {
    seedSample(tdb, 's2');
    for (let i = 1; i <= 6; i++) {
      seedIssue(tdb, 's2', `k${i}`, `2026-07-15T0${i}:00:00.000Z`);
    }
    // 再加一个 count=2 的，验证排序
    seedIssue(tdb, 's2', 'k9', '2026-07-15T09:00:00.000Z');
    seedIssue(tdb, 's2', 'k9', '2026-07-16T09:00:00.000Z');

    const r = getStudyStats(repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.topErrors).toHaveLength(5);
    // k9 计数 2 排第一，其余 6 个 count=1 取前 4 个（按 key 升序）
    expect(d.topErrors[0]).toEqual({ key: 'k9', count: 2 });
    expect(d.topErrors.map((i) => i.key).slice(1)).toEqual(['k1', 'k2', 'k3', 'k4']);
  });
});
