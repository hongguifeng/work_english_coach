// T034 — 录音纯逻辑单元测试（src/shared/logic/recording.ts）
import { describe, expect, it } from 'vitest';
import { formatDurationMs, isSafeRecordingId } from '../src/shared/logic/recording';

describe('isSafeRecordingId', () => {
  it('accepts standard UUIDs (lower and upper case)', () => {
    expect(isSafeRecordingId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isSafeRecordingId('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('rejects path traversal and malformed ids', () => {
    expect(isSafeRecordingId('../../etc/passwd')).toBe(false);
    expect(isSafeRecordingId('..\\..\\evil')).toBe(false);
    expect(isSafeRecordingId('a-b-c')).toBe(false);
    expect(isSafeRecordingId('123e4567-e89b-12d3-a456-4266141740001')).toBe(false);
    expect(isSafeRecordingId('')).toBe(false);
    expect(isSafeRecordingId('123e4567x89b-12d3-a456-426614174000')).toBe(false);
  });
});

describe('formatDurationMs', () => {
  it('formats as MM:SS', () => {
    expect(formatDurationMs(0)).toBe('00:00');
    expect(formatDurationMs(999)).toBe('00:00');
    expect(formatDurationMs(61_000)).toBe('01:01');
    expect(formatDurationMs(1_215_000)).toBe('20:15');
  });

  it('clamps negative to 00:00 and caps at 99:59', () => {
    expect(formatDurationMs(-5000)).toBe('00:00');
    expect(formatDurationMs(5_999_999)).toBe('99:59');
  });
});
