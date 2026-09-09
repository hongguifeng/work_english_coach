// T029 — 今日任务查询（reviewService.getTodayReview）测试
//
// 覆盖（docs/08 T029 验收）：
// - 只返回「到期（scheduledAt <= now）且 pending」的任务
// - 排序：错题（skillId 非空）优先，其次到期时间早的
// - 未来任务（未到 scheduledAt）不出现
// - completedToday：只统计 completedAt >= 今日 0:00 的任务
// - 空库 → {tasks: [], completedToday: 0, pending: 0}（空状态）
// - context 为 null → 空串；keywords 非法 JSON → 空数组（视图模型防御）
import { describe, it, expect } from 'vitest';
import { getTodayReview } from '../src/main/services/reviewService';
import { createRepositories } from '../src/main/db/repositories';
import { createTestDb } from './db/testDb';
import type { Result } from '../src/shared/types/app';

function mustOk<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error('unexpected Result failure: ' + r.error.message);
}

/** 构造一个隔离测试环境；now 注入以便控制“今天/到期”边界。 */
function setup() {
  const tdb = createTestDb();
  const repos = createRepositories(tdb.db);
  return { tdb, repos };
}

/** 本地时区某时刻的 ISO 字符串。 */
function localIso(dayOffset: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('getTodayReview', () => {
  it('returns only due (scheduledAt <= now) pending tasks', async () => {
    const { tdb, repos } = setup();
    const now = new Date();
    void repos.reviewTasks.create({
      taskType: 'transfer',
      promptZh: 'due yesterday',
      referenceAnswer: 'r1',
      scheduledAt: localIso(-1),
    });
    void repos.reviewTasks.create({
      taskType: 'rewrite',
      promptZh: 'due just now',
      referenceAnswer: 'r2',
      scheduledAt: new Date(now.getTime() - 60_000).toISOString(),
    });
    void repos.reviewTasks.create({
      taskType: 'transfer',
      promptZh: 'due tomorrow (future)',
      referenceAnswer: 'r3',
      scheduledAt: localIso(1),
    });

    const res = getTodayReview(repos, now);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    const texts = res.data.tasks.map((t) => t.promptZh);
    expect(texts).toContain('due yesterday');
    expect(texts).toContain('due just now');
    expect(texts).not.toContain('due tomorrow (future)');
    expect(res.data.pending).toBe(2);

    tdb.close();
  });

  it('orders skill-based (wrong question) tasks before expression-based ones', async () => {
    const { tdb, repos } = setup();
    // now 固定为本地今天 12:00（不依赖真实时间：种子任务在 08:00/10:00，保证两者都已到期）
    const now = new Date(localIso(0, 12));
    const skill = mustOk(
      repos.skills.upsert({
        skillKey: 'tense_present_perfect',
        title: '现在完成时',
        category: 'tense',
        explanationZh: 'have done 表示已完成',
      }),
    );
    const expr = mustOk(
      repos.expressions.create({
        title: 'Could you please',
        chineseMeaning: '礼貌请求',
        example: 'Could you please send me the file?',
      }),
    );
    // 表达任务到期更早（今天 08:00），知识点任务到期更晚（今天 10:00）
    // → 但错题（skill）应排在前面
    void repos.reviewTasks.create({
      taskType: 'rewrite',
      expressionId: expr.id,
      promptZh: 'expression task (earlier)',
      referenceAnswer: 'e',
      scheduledAt: localIso(0, 8),
    });
    void repos.reviewTasks.create({
      taskType: 'transfer',
      skillId: skill.id,
      promptZh: 'skill task (later)',
      referenceAnswer: 's',
      scheduledAt: localIso(0, 10),
    });

    const res = getTodayReview(repos, now);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.tasks.map((t) => t.promptZh)).toEqual([
      'skill task (later)',
      'expression task (earlier)',
    ]);

    tdb.close();
  });

  it('counts completedToday only for completions since local midnight', async () => {
    const { tdb, repos } = setup();
    const now = new Date();
    const a = mustOk(
      repos.reviewTasks.create({
        taskType: 'transfer',
        promptZh: 'completed today',
        referenceAnswer: 'a',
        scheduledAt: localIso(-1),
      }),
    );
    const b = mustOk(
      repos.reviewTasks.create({
        taskType: 'rewrite',
        promptZh: 'completed yesterday',
        referenceAnswer: 'b',
        scheduledAt: localIso(-2),
      }),
    );
    void repos.reviewTasks.complete(a.id); // completedAt = now（今天）
    // b：手工把 completedAt 改到昨天
    tdb.client
      .prepare('UPDATE review_tasks SET status = ?, completedAt = ? WHERE id = ?')
      .run('completed', localIso(-1), b.id);

    const res = getTodayReview(repos, now);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.completedToday).toBe(1); // 只有 a（今天完成）

    tdb.close();
  });

  it('returns an empty view (empty state) when there are no tasks', async () => {
    const { tdb, repos } = setup();
    const res = getTodayReview(repos, new Date());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data).toEqual({ tasks: [], completedToday: 0, pending: 0 });

    tdb.close();
  });

  it('defensive view mapping: null context -> empty string; invalid keywords JSON -> []', async () => {
    const { tdb, repos } = setup();
    const row = mustOk(
      repos.reviewTasks.create({
        taskType: 'correction',
        promptZh: 'defensive',
        context: null,
        keywords: null,
        referenceAnswer: 'd',
        scheduledAt: localIso(-1),
      }),
    );
    tdb.client
      .prepare('UPDATE review_tasks SET context = NULL, keywords = ? WHERE id = ?')
      .run('not-json', row.id);

    const res = getTodayReview(repos, new Date());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    const t = res.data.tasks.find((x) => x.id === row.id);
    expect(t).toBeDefined();
    expect(t!.context).toBe('');
    expect(t!.keywords).toEqual([]);

    tdb.close();
  });

  it('propagates repository failure (db error) as a non-ok Result', async () => {
    const { tdb, repos } = setup();
    // 模拟仓储失败（关闭后再查询）
    tdb.close();
    const res = getTodayReview(repos, new Date());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    // node:sqlite 对已关闭的句柄会抛错 → 归类为 db 错误
    expect(['db', 'unknown']).toContain(res.error.code);
  });
});
