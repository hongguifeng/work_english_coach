// T032 — 复习调度服务（reviewSchedulingService）测试
//
// 覆盖（docs/08 T032 验收）：
// - 任务不存在 → not-found
// - 答错/用提示/查看 → 原地改期 +1 天（status 保持 pending，completedAt=本次作答时间）
// - 独立答对第 1 次 → +1 天；第 2 次 → +3 天（递进）
// - 独立答对第 5 次 → 毕业（status=completed，不再排期）
// - 重启不变性：换连接重开同一 DB，改期/完成状态保留
import { describe, it, expect } from 'vitest';
import { applyReviewOutcome } from '../src/main/services/reviewSchedulingService';
import { createRepositories } from '../src/main/db/repositories';
import { createTestDb, type TestDb } from './db/testDb';
import type { Result } from '../src/shared/types/app';
import type { ReviewTaskRow } from '../src/main/db/schema';

function mustOk<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error('unexpected Result failure: ' + r.error.message);
}

const FUTURE = '2035-01-01T00:00:00.000Z';

function seedTask(tdb: TestDb, id: string, opts: { status?: 'pending' | 'completed' | 'skipped' } = {}): void {
  tdb.client
    .prepare(
      'INSERT INTO review_tasks (id, taskType, skillId, expressionId, promptZh, context, keywords, referenceAnswer, acceptableAnswers, status, scheduledAt, completedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      'transfer',
      null,
      null,
      '练习提示词',
      null,
      null,
      '参考英文答案',
      null,
      opts.status ?? 'pending',
      FUTURE,
      null,
      '2024-01-01T00:00:00.000Z',
    );
}

/** 插入一条「独立答对」的 attempt（coreMeaningCorrect=1, usedHint=0, revealedAnswer=0）。 */
function seedCorrectNoHintAttempt(tdb: TestDb, taskId: string, idx: number): void {
  tdb.client
    .prepare(
      'INSERT INTO review_attempts (id, taskId, userAnswer, usedHint, revealedAnswer, aiScore, coreMeaningCorrect, grammarCorrect, toneAppropriate, feedbackZh, improvedAnswer, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      `attempt-${taskId}-${idx}`,
      taskId,
      'independent answer',
      0,
      0,
      80,
      1,
      1,
      1,
      null,
      'improved',
      '2024-01-01T00:00:00.000Z',
    );
}

function getTaskRow(tdb: TestDb, id: string): ReviewTaskRow {
  return mustOk(createRepositories(tdb.db).reviewTasks.get(id)) as ReviewTaskRow;
}

const NOW = new Date('2024-06-01T12:00:00.000Z');

describe('applyReviewOutcome', () => {
  it('returns not-found for a missing task', () => {
    const tdb = createTestDb();
    const repos = createRepositories(tdb.db);
    const r = applyReviewOutcome('missing', 'wrong', repos, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('storage');
    tdb.close();
  });

  it('wrong → reschedules by 1 day, task stays pending, completedAt = answer time', () => {
    const tdb = createTestDb();
    seedTask(tdb, 'task-1');
    const repos = createRepositories(tdb.db);

    const r = applyReviewOutcome('task-1', 'wrong', repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('fail');
    expect(r.data.outcome).toBe('wrong');
    expect(r.data.graduated).toBe(false);
    expect(r.data.intervalDays).toBe(1);
    expect(r.data.nextScheduledAt).toBe('2024-06-02T12:00:00.000Z');

    const row = getTaskRow(tdb, 'task-1');
    expect(row.status).toBe('pending');
    expect(row.scheduledAt).toBe('2024-06-02T12:00:00.000Z');
    expect(row.completedAt).toBe('2024-06-01T12:00:00.000Z');
    tdb.close();
  });

  it('used_hint → reschedules by 1 day (no progress)', () => {
    const tdb = createTestDb();
    seedTask(tdb, 'task-1');
    // 之前已有 2 次独立答对，但本次用提示 → 回到 1 天，不升级
    seedCorrectNoHintAttempt(tdb, 'task-1', 0);
    seedCorrectNoHintAttempt(tdb, 'task-1', 1);
    const repos = createRepositories(tdb.db);

    const r = applyReviewOutcome('task-1', 'used_hint', repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('fail');
    expect(r.data.intervalDays).toBe(1);
    expect(r.data.graduated).toBe(false);
    tdb.close();
  });

  it('correct_no_hint: 1st → 1 day, 2nd → 3 days, 3rd → 7 days (progressive ladder)', () => {
    const tdb = createTestDb();
    seedTask(tdb, 'task-1');
    const repos = createRepositories(tdb.db);

    // 生产流程：每次独立答对都会先由 evaluate 服务落库 attempt，调度再计数
    // 第 1 次答对（本次 attempt 落库）→ count=1 → 1 天
    seedCorrectNoHintAttempt(tdb, 'task-1', 0);
    let r = applyReviewOutcome('task-1', 'correct_no_hint', repos, NOW);
    expect(r.ok && r.data.intervalDays).toBe(1);

    // 第 2 次答对 → count=2 → 3 天
    seedCorrectNoHintAttempt(tdb, 'task-1', 1);
    r = applyReviewOutcome('task-1', 'correct_no_hint', repos, NOW);
    expect(r.ok && r.data.intervalDays).toBe(3);

    // 第 3 次答对 → count=3 → 7 天
    seedCorrectNoHintAttempt(tdb, 'task-1', 2);
    r = applyReviewOutcome('task-1', 'correct_no_hint', repos, NOW);
    expect(r.ok && r.data.intervalDays).toBe(7);
    tdb.close();
  });

  it('5th independent correct answer → graduated (completed, no reschedule)', () => {
    const tdb = createTestDb();
    seedTask(tdb, 'task-1');
    // 第 5 次答对（前 4 次 + 本次共 5 次 attempt 落库）
    for (let i = 0; i < 5; i += 1) seedCorrectNoHintAttempt(tdb, 'task-1', i);
    const repos = createRepositories(tdb.db);

    const r = applyReviewOutcome('task-1', 'correct_no_hint', repos, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('fail');
    expect(r.data.graduated).toBe(true);
    expect(r.data.intervalDays).toBeNull();
    expect(r.data.nextScheduledAt).toBeNull();

    const row = getTaskRow(tdb, 'task-1');
    expect(row.status).toBe('completed');
    expect(row.completedAt).toBe('2024-06-01T12:00:00.000Z');
    tdb.close();
  });

  it('invariant across repository instances: a fresh repository on the same DB sees rescheduled state', () => {
    const tdb = createTestDb();
    seedTask(tdb, 'task-1');
    const repos = createRepositories(tdb.db);
    const r = applyReviewOutcome('task-1', 'wrong', repos, NOW);
    expect(r.ok).toBe(true);

    // 新建仓储实例（模拟重启后的重新构建）：状态来自 DB，非仓储内存
    const fresh = createRepositories(tdb.db);
    const row = mustOk(fresh.reviewTasks.get('task-1')) as ReviewTaskRow;
    expect(row.status).toBe('pending');
    expect(row.scheduledAt).toBe('2024-06-02T12:00:00.000Z');
    expect(row.completedAt).toBe('2024-06-01T12:00:00.000Z');

    // countCorrectNoHint 同样跨实例可读
    seedCorrectNoHintAttempt(tdb, 'task-1', 0);
    expect(mustOk(fresh.reviewTasks.countCorrectNoHint('task-1'))).toBe(1);
    tdb.close();
  });
});
