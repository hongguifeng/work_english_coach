// T027 — 错误档案 IPC（主进程）
//
// 暴露的渠道：
//   ▎archive:errors   按 skillKey 聚合的错误档案（可过滤 category / severity）
//
// 规则：
// - 过滤参数在 IPC 边界用 Zod 校验；非法 → validation 错误。
// - 返回统一 Result<T>；日志只记录条数，不记录错误原文（避免敏感工作文本进日志）。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { ErrorArchiveEntry } from '../../shared/types/errorArchive';
import { ISSUE_CATEGORIES } from '../services/aiSchemas';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { buildErrorArchive } from '../services/errorArchiveService';
import { devLog } from '../log';

const archiveFilterSchema = z
  .object({
    category: z.enum(ISSUE_CATEGORIES).optional(),
    severity: z.enum(['error', 'suggestion']).optional(),
  })
  .optional();

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerErrorArchiveIpc(): void {
  ipcMain.handle('archive:errors', (event, rawFilter?: unknown): Result<ErrorArchiveEntry[]> => {
    try {
      void event;
      const parsed = archiveFilterSchema.safeParse(rawFilter ?? undefined);
      if (!parsed.success) {
        return err('validation', '错误档案过滤参数非法: ' + parsed.error.issues[0]?.message);
      }
      const result = buildErrorArchive(createRepositories(getDatabase()), parsed.data);
      if (!result.ok) devLog('archive:errors fail:', result.error.debug ?? result.error.message);
      return result;
    } catch (e) {
      devLog('archive:errors error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
