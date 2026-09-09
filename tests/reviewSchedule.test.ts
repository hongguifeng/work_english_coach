import { describe, it, expect } from 'vitest';
import { nextReviewIntervalDays, REVIEW_INTERVALS_DAYS, computeScheduling, addDaysIso } from '../src/shared/logic/reviewSchedule';

describe('nextReviewIntervalDays', () => {
	it('returns 1 day for non-correct outcomes at any attempt index', () => {
		expect(nextReviewIntervalDays('used_hint', 0)).toBe(1);
		expect(nextReviewIntervalDays('used_hint', 5)).toBe(1);
		expect(nextReviewIntervalDays('revealed', 3)).toBe(1);
		expect(nextReviewIntervalDays('wrong', 10)).toBe(1);
	});

	it('progresses through the interval ladder for correct_no_hint', () => {
		expect(nextReviewIntervalDays('correct_no_hint', 0)).toBe(1);
		expect(nextReviewIntervalDays('correct_no_hint', 1)).toBe(3);
		expect(nextReviewIntervalDays('correct_no_hint', 2)).toBe(7);
		expect(nextReviewIntervalDays('correct_no_hint', 3)).toBe(14);
		expect(nextReviewIntervalDays('correct_no_hint', 4)).toBe(30);
	});

	it('caps at 30 days for attemptIndex beyond the ladder length', () => {
		expect(nextReviewIntervalDays('correct_no_hint', 5)).toBe(30);
		expect(nextReviewIntervalDays('correct_no_hint', 99)).toBe(30);
	});

	it('clamps negative attemptIndex to 0 (1 day)', () => {
		expect(nextReviewIntervalDays('correct_no_hint', -1)).toBe(1);
		expect(nextReviewIntervalDays('correct_no_hint', -100)).toBe(1);
	});

	it('ladder matches the documented intervals', () => {
		expect([...REVIEW_INTERVALS_DAYS]).toEqual([1, 3, 7, 14, 30]);
	});
});

describe('computeScheduling (T032)', () => {
	it('wrong / used_hint / revealed always reschedule by 1 day regardless of history', () => {
		expect(computeScheduling('wrong', 0)).toEqual({ intervalDays: 1, graduated: false });
		expect(computeScheduling('wrong', 4)).toEqual({ intervalDays: 1, graduated: false });
		expect(computeScheduling('used_hint', 3)).toEqual({ intervalDays: 1, graduated: false });
		expect(computeScheduling('revealed', 2)).toEqual({ intervalDays: 1, graduated: false });
	});

	it('correct_no_hint follows the ladder 1 → 3 → 7 → 14 by cumulative count (incl. current)', () => {
		expect(computeScheduling('correct_no_hint', 1)).toEqual({ intervalDays: 1, graduated: false });
		expect(computeScheduling('correct_no_hint', 2)).toEqual({ intervalDays: 3, graduated: false });
		expect(computeScheduling('correct_no_hint', 3)).toEqual({ intervalDays: 7, graduated: false });
		expect(computeScheduling('correct_no_hint', 4)).toEqual({ intervalDays: 14, graduated: false });
	});

	it('5th independent correct answer graduates (no reschedule)', () => {
		expect(computeScheduling('correct_no_hint', 5)).toEqual({ intervalDays: 0, graduated: true });
		expect(computeScheduling('correct_no_hint', 6)).toEqual({ intervalDays: 0, graduated: true });
	});

	it('never graduates for non-independent outcomes even with high counts', () => {
		expect(computeScheduling('used_hint', 99).graduated).toBe(false);
		expect(computeScheduling('wrong', 99).graduated).toBe(false);
		expect(computeScheduling('revealed', 99).graduated).toBe(false);
	});

	it('clamps zero counts (first independent answer → 1 day)', () => {
		expect(computeScheduling('correct_no_hint', 0)).toEqual({ intervalDays: 1, graduated: false });
	});
});

describe('addDaysIso (T032)', () => {
	it('adds whole-day offsets in UTC, keeping time-of-day', () => {
		expect(addDaysIso(new Date('2024-06-01T12:00:00.000Z'), 1)).toBe('2024-06-02T12:00:00.000Z');
		expect(addDaysIso(new Date('2024-06-01T12:00:00.000Z'), 0)).toBe('2024-06-01T12:00:00.000Z');
		expect(addDaysIso(new Date('2024-06-01T23:30:00.000Z'), 3)).toBe('2024-06-04T23:30:00.000Z');
	});

	it('crosses month and year boundaries', () => {
		expect(addDaysIso(new Date('2024-06-28T00:00:00.000Z'), 30)).toBe('2024-07-28T00:00:00.000Z');
		expect(addDaysIso(new Date('2024-12-28T00:00:00.000Z'), 30)).toBe('2025-01-27T00:00:00.000Z');
	});

	it('is deterministic (same input → same ISO string)', () => {
		const base = new Date('2024-11-30T10:20:30.500Z');
		expect(addDaysIso(base, 1)).toBe(addDaysIso(new Date(base.getTime()), 1));
		expect(addDaysIso(base, 1)).toBe('2024-12-01T10:20:30.500Z');
	});
});
