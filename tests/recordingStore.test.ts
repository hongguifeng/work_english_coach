// T034 — 录音存储单元测试（主进程 recordingStore，使用临时目录）
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupStaleRecordings,
  deleteRecording,
  listRecordings,
  RECORDING_MAX_AGE_MS,
  saveRecording,
} from '../src/main/services/recordingStore';

// 注意：getRecordingDir() 默认依赖 electron app.getPath（node 环境不可用），
// 所以本测试始终显式传入临时目录。
let dir: string;
const createdDirs: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wec-rec-test-'));
  createdDirs.push(dir);
});

afterAll(() => {
  for (const d of createdDirs) rmSync(d, { recursive: true, force: true });
});

function toAb(buf: Buffer): ArrayBuffer {
  // Node Buffer → ArrayBuffer（与渲染进程 Blob.arrayBuffer() 的产物等价）
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

describe('saveRecording', () => {
  it('writes a file inside the given dir and returns a safe view', () => {
    const data = toAb(Buffer.from('fake-audio-bytes'));
    const r = saveRecording(data, 'audio/webm', dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.path.startsWith(dir)).toBe(true);
    expect(r.data.sizeBytes).toBe(16);
    expect(r.data.mimeType).toBe('audio/webm');
    expect(r.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails with storage error when dir cannot be created', () => {
    const blocker = join(dir, 'blocker.txt');
    writeFileSync(blocker, 'x');
    const r = saveRecording(toAb(Buffer.from('x')), 'audio/webm', join(dir, 'blocker.txt', 'sub'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('storage');
  });
});

describe('deleteRecording', () => {
  it('deletes a saved file and is idempotent', () => {
    const s = saveRecording(toAb(Buffer.from('abc')), 'audio/webm', dir);
    if (!s.ok) throw new Error('save failed');
    expect(join(dir, `${s.data.id}.webm`)).toBeTruthy();

    const d1 = deleteRecording(s.data.id, dir);
    expect(d1.ok).toBe(true);
    const d2 = deleteRecording(s.data.id, dir); // 第二次：幂等
    expect(d2.ok).toBe(true);
  });

  it('rejects unsafe ids with validation error', () => {
    const r = deleteRecording('../../evil', dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
  });
});

describe('listRecordings', () => {
  it('lists .webm files with UUID names, ignores other files, newest first', () => {
    const a = saveRecording(toAb(Buffer.from('a')), 'audio/webm', dir);
    const b = saveRecording(toAb(Buffer.from('b')), 'audio/webm', dir);
    if (!a.ok || !b.ok) throw new Error('save failed');
    writeFileSync(join(dir, 'notes.txt'), 'x'); // 非录音文件
    writeFileSync(join(dir, 'bad-name.webm'), 'x'); // 非 UUID 名

    const r = listRecordings(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((x) => x.id)).toContain(a.data.id);
    expect(r.data.map((x) => x.id)).toContain(b.data.id);
    expect(r.data).toHaveLength(2);
  });

  it('returns empty list for a missing dir', () => {
    const r = listRecordings(join(dir, 'nope'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });
});

describe('cleanupStaleRecordings', () => {
  it('removes files older than maxAge, keeps fresh ones', () => {
    const old = saveRecording(toAb(Buffer.from('old')), 'audio/webm', dir);
    const fresh = saveRecording(toAb(Buffer.from('fresh')), 'audio/webm', dir);
    if (!old.ok || !fresh.ok) throw new Error('save failed');

    const past = new Date(Date.now() - RECORDING_MAX_AGE_MS - 1000);
    utimesSync(join(dir, `${old.data.id}.webm`), past, past);

    const r2 = cleanupStaleRecordings(Date.now(), RECORDING_MAX_AGE_MS, dir);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data).toBe(1); // 只删了旧的
    const remaining = listRecordings(dir);
    if (!remaining.ok) throw new Error('list failed');
    expect(remaining.data.map((x) => x.id)).toEqual([fresh.data.id]);
  });

  it('does not touch files without UUID names', () => {
    writeFileSync(join(dir, 'stray.webm'), 'x');
    const past = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(join(dir, 'stray.webm'), past, past);
    const r = cleanupStaleRecordings(Date.now(), RECORDING_MAX_AGE_MS, dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(0);
    expect(join(dir, 'stray.webm')).toBeTruthy();
  });

  it('returns 0 for missing dir (no throw)', () => {
    const r = cleanupStaleRecordings(Date.now(), RECORDING_MAX_AGE_MS, join(dir, 'nope'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(0);
  });
});
