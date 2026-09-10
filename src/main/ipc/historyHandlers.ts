import { ipcMain } from 'electron';
import { z } from 'zod';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { HistoryRecord, HistoryRecordSummary } from '../../shared/types/history';
import type { KeyLearningPoint, PracticeTask } from '../../shared/types/ai';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { devLog } from '../log';

const idSchema = z.string().min(1);

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', (): Result<HistoryRecordSummary[]> => {
    try {
      const result = createRepositories(getDatabase()).samples.listWithIssueCounts();
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data.map(({ issueCount, keyLearningPoint, practice, ...sample }) => ({
          ...sample,
          keyLearningPoint: parseJson<KeyLearningPoint>(keyLearningPoint),
          practice: parseJson<PracticeTask>(practice),
          issueCount,
        })),
      };
    } catch (e) {
      devLog('history:list error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle('history:get', (_e, id: unknown): Result<HistoryRecord | null> => {
    try {
      const parsedId = idSchema.safeParse(id);
      if (!parsedId.success) return err('validation', '历史记录 ID 无效');
      const repos = createRepositories(getDatabase());
      const sample = repos.samples.getWithQuestions(parsedId.data);
      if (!sample.ok) return sample;
      if (sample.data === null) return { ok: true, data: null };
      const issues = repos.issues.getBySampleId(parsedId.data);
      if (!issues.ok) return issues;
      return {
        ok: true,
        data: {
          ...sample.data,
          keyLearningPoint: parseJson<KeyLearningPoint>(sample.data.keyLearningPoint),
          practice: parseJson<PracticeTask>(sample.data.practice),
          issueCount: issues.data.length,
          issues: issues.data,
        },
      };
    } catch (e) {
      devLog('history:get error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}