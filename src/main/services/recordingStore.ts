// T034 — 录音文件存储（主进程）
//
// 隐私规则（docs/01、docs/08 T034）：
// - 不默认永久保存：默认不落盘；用户主动选择后才写入本模块管理的临时目录。
// - 临时目录：userData/work-english-coach/recordings（测试可用 WEC_REC_DIR 覆盖）。
// - 启动时清理超过 7 天的录音文件（cleanupStaleRecordings）。
// - 写盘/删除/列举只接受 UUID 形态 id（isSafeRecordingId），防止路径穿越。
// - 日志只记录 id 与大小，不记录音频内容。
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import { isSafeRecordingId } from '../../shared/logic/recording';
import type { RecordingSavedView } from '../../shared/types/recording';

/** 录音默认保留时长（7 天；到期自动清理，满足“不默认永久保存”）。 */
export const RECORDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 录音目录（生产：userData/work-english-coach/recordings；测试：WEC_REC_DIR）。
 * 与 getDbDir() 同目录约定，但独立子目录，便于整目录清理。
 */
export function getRecordingDir(): string {
  if (process.env.WEC_REC_DIR) return process.env.WEC_REC_DIR;
  return join(app.getPath('userData'), 'work-english-coach', 'recordings');
}

/**
 * 保存录音到临时目录。
 * @param data  音频二进制（来自渲染进程 MediaRecorder Blob）
 * @param mimeType 如 'audio/webm'
 */
export function saveRecording(data: ArrayBuffer, mimeType: string, dir: string = getRecordingDir()): Result<RecordingSavedView> {
  const id = randomUUID();
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.webm`);
    writeFileSync(path, Buffer.from(data));
    const sizeBytes = statSync(path).size;
    return ok({ id, path, sizeBytes, mimeType, createdAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('storage', `保存录音失败: ${msg}`);
  }
}

/** 删除录音文件（只接受 UUID id；文件不存在视为成功，幂等）。 */
export function deleteRecording(id: string, dir: string = getRecordingDir()): Result<null> {
  if (!isSafeRecordingId(id)) {
    return err('validation', '无效的录音 id');
  }
  try {
    rmSync(join(dir, `${id}.webm`), { force: true });
    return ok(null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('storage', `删除录音失败: ${msg}`);
  }
}

/** 列出当前临时目录中的录音（按时间倒序）。 */
export function listRecordings(dir: string = getRecordingDir()): Result<RecordingSavedView[]> {
  try {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      names = []; // 目录不存在 = 空列表
    }
    const items: RecordingSavedView[] = names
      .filter((n) => n.endsWith('.webm'))
      .map((n) => n.replace(/\.webm$/, ''))
      .filter((id) => isSafeRecordingId(id))
      .map((id) => {
        const st = statSync(join(dir, `${id}.webm`));
        return {
          id,
          path: join(dir, `${id}.webm`),
          sizeBytes: st.size,
          mimeType: 'audio/webm',
          createdAt: st.birthtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('storage', `读取录音列表失败: ${msg}`);
  }
}

/** 清理超过 maxAgeMs 的录音文件（启动时调用；只删本目录内 .webm）。 */
export function cleanupStaleRecordings(now: number = Date.now(), maxAgeMs: number = RECORDING_MAX_AGE_MS, dir: string = getRecordingDir()): Result<number> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return ok(0); // 目录不存在
  }
  let removed = 0;
  for (const n of names) {
    if (!/\.webm$/.test(n)) continue;
    const id = n.replace(/\.webm$/, '');
    if (!isSafeRecordingId(id)) continue;
    try {
      const st = statSync(join(dir, n));
      if (now - st.mtimeMs > maxAgeMs) {
        rmSync(join(dir, n), { force: true });
        removed += 1;
      }
    } catch {
      // 单个文件 stat 失败不影响其余
    }
  }
  return ok(removed);
}
