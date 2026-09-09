// T033 — 学习统计纯逻辑（无 DB / 无副作用，可单测）
//
// 所有日期计算使用本地时区（用户在自己电脑上练习，"本周/近七天"按本地日历理解）。
import type { TopErrorItem, TrendPoint } from '../types/studyStats';

/** 本地时区日期键 YYYY-MM-DD。 */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地时区本周起点（周一 00:00）。 */
export function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - dow);
  return d;
}

/** 近 N 天本地日期桶（含今天，最旧在前）。 */
export function buildTrendBuckets(now: Date, days = 7): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(localDayKey(d));
  }
  return out;
}

/** 把 createdAt（ISO 字符串）按本地日期归桶；无数据的桶补 0。 */
export function aggregateTrend(createdAts: readonly string[], buckets: readonly string[]): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const c of createdAts) {
    const key = localDayKey(new Date(c));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return buckets.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

/**
 * 频次表取 top N（次数降序；同次按 key 字典序，保证确定性）。
 * 用于"高频错误"（key = 知识点 skillKey）。
 */
export function topItems(counts: Record<string, number>, n = 5): TopErrorItem[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}
