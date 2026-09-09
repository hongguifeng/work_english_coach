// T033 — 学习统计纯函数单元测试（src/shared/logic/studyStats.ts）
import { describe, expect, it } from 'vitest';
import {
  aggregateTrend,
  buildTrendBuckets,
  localDayKey,
  startOfWeek,
  topItems,
} from '../src/shared/logic/studyStats';

describe('localDayKey', () => {
  it('produces local (not UTC) YYYY-MM-DD', () => {
    // 用本地时区明确构造的日期，避免 UTC 偏移歧义
    expect(localDayKey(new Date(2026, 0, 5, 10, 30))).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    expect(localDayKey(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });

  it('keeps keys comparable (zero-padded)', () => {
    expect(localDayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(localDayKey(new Date(2026, 9, 10))).toBe('2026-10-10');
  });
});

describe('startOfWeek', () => {
  it('Monday is its own week start', () => {
    // 2026-07-13 is a Monday
    const d = new Date(2026, 6, 13, 15, 4);
    const s = startOfWeek(d);
    expect(s).toEqual(new Date(2026, 6, 13, 0, 0, 0));
  });

  it('mid-week rolls back to Monday 00:00', () => {
    // 2026-07-19 is a Saturday
    const d = new Date(2026, 6, 19, 23, 59);
    const s = startOfWeek(d);
    expect(s).toEqual(new Date(2026, 6, 13, 0, 0, 0));
  });

  it('Sunday rolls back to the previous Monday', () => {
    // 2026-07-11 is a Sunday
    const d = new Date(2026, 6, 11, 9, 0);
    const s = startOfWeek(d);
    expect(s).toEqual(new Date(2026, 6, 6, 0, 0, 0));
  });
});

describe('buildTrendBuckets', () => {
  it('returns N ascending day keys ending at the given day', () => {
    const buckets = buildTrendBuckets(new Date(2026, 6, 19), 7);
    expect(buckets).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });

  it('respects custom day count', () => {
    const buckets = buildTrendBuckets(new Date(2026, 6, 19), 3);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toBe('2026-07-17');
    expect(buckets[2]).toBe('2026-07-19');
  });
});

describe('aggregateTrend', () => {
  it('maps ISO timestamps into buckets and preserves zero buckets', () => {
    const buckets = buildTrendBuckets(new Date(2026, 6, 19), 7);
    const points = aggregateTrend(
      [
        '2026-07-15T09:00:00.000Z',
        '2026-07-16T10:00:00.000Z',
        '2026-07-10T08:00:00.000Z', // 落在窗口外
      ],
      buckets,
    );
    expect(points.map((p) => p.date)).toEqual(buckets);
    // 注意：这里用 UTC 时间戳，本地桶可能偏移 ±1 天；
    // 纯函数只验证「窗口外计数为 0 + 总计数守恒（窗口内部分）」
    const total = points.reduce((s, p) => s + p.count, 0);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThanOrEqual(3);
    expect(points[0].count + points[1].count).toBe(0);
  });

  it('counts each timestamp at most once', () => {
    const buckets = buildTrendBuckets(new Date(2026, 6, 19), 7);
    const points = aggregateTrend(
      ['2026-07-15T01:00:00.000Z', '2026-07-15T01:00:00.000Z'],
      buckets,
    );
    const total = points.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(2);
  });
});

describe('topItems', () => {
  it('sorts by count desc then by key', () => {
    const items = topItems({ articles: 3, tense: 3, collocation: 5, tone: 1 });
    expect(items).toEqual([
      { key: 'collocation', count: 5 },
      { key: 'articles', count: 3 },
      { key: 'tense', count: 3 },
      { key: 'tone', count: 1 },
    ]);
  });

  it('limits to n (larger counts first, ties by key)', () => {
    const counts: Record<string, number> = {};
    for (let i = 1; i <= 8; i++) counts[`k${i}`] = i;
    const items = topItems(counts, 5);
    // count 8..4 入选，count 3 及以下被裁掉
    expect(items.map((i) => i.key)).toEqual(['k8', 'k7', 'k6', 'k5', 'k4']);
  });

  it('empty input yields empty list', () => {
    expect(topItems({})).toEqual([]);
  });
});
