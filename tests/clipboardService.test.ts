import { describe, expect, it } from 'vitest';
import { writeClipboardText, type ClipboardBackend } from '../src/main/services/clipboardService';

function makeFake(shouldThrow = false): ClipboardBackend & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    writeText(text: string): void {
      if (shouldThrow) throw new Error('boom');
      written.push(text);
    },
  };
}

describe('writeClipboardText', () => {
  it('成功时写入后端并返回 ok(true)', () => {
    const fake = makeFake();
    const r = writeClipboardText(fake, 'hello');
    expect(r).toEqual({ ok: true, data: true });
    expect(fake.written).toEqual(['hello']);
  });

  it('后端抛错时返回 err(storage)', () => {
    const fake = makeFake(true);
    const r = writeClipboardText(fake, 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('storage');
      expect(r.error.message).toBe('复制到剪贴板失败');
    }
    expect(fake.written).toEqual([]);
  });
});
