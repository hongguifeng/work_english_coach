import { describe, it, expect } from 'vitest';
import { nextReviewIntervalDays, REVIEW_INTERVALS_DAYS } from '../src/shared/logic/reviewSchedule';

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
