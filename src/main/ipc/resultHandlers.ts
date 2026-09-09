// T025 — 保存纠错结果 IPC（主进程）
//
// 暴露的渠道：
//   ▎result:save  用户确认纠错结果后：样本 + 错误列表 + 重点知识点（upsert）+（可选）表达 → SQLite
//
// 规则（docs/02、docs/06、docs/08 T025）：
// - payload 在 IPC 边界用 Zod 重新校验（纵深防御：renderer 即使被篡改/出 bug，
//   写入前也必须通过 AI 契约 Schema；非法 → validation 错误，不写库）。
// - 返回统一 Result<SaveCorrectionSummary>；异常经 classifyError 归类，不向 UI 抛裸异常。
// - 日志只记录 sampleId / 条数等元信息，不记录完整工作文本（避免敏感内容进日志）。
// - 不做 data:changed 广播：该事件目前语义为「清空全部数据」（表达库仍是 mock 数据，
//   广播会误清空列表）。T026 起表达库接真实 DB 时再引入跨页刷新。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type {
  SaveCorrectionPayload,
  SaveCorrectionSummary,
} from '../../shared/types/saveResult';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { devLog } from '../log';
import {
  analyzeDraftInputSchema,
  draftAnalysisSchema,
  formatZodError,
} from '../services/aiSchemas';
import { saveCorrectionResult } from '../services/saveResultService';

/** 保存载荷在 IPC 边界重新校验（复用 T021/T022 的 AI 契约 Schema）。 */
const savePayloadSchema = z.object({
  input: analyzeDraftInputSchema,
  result: draftAnalysisSchema,
  saveOriginal: z.boolean(),
  saveExpression: z.boolean(),
}) as z.ZodType<SaveCorrectionPayload>;

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerResultIpc(): void {
  ipcMain.handle('result:save', (_e, payload: unknown): Result<SaveCorrectionSummary> => {
    try {
      const parsed = savePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return err('validation', formatZodError(parsed.error));
      }

      const result = saveCorrectionResult(createRepositories(getDatabase()), parsed.data);
      if (result.ok) {
        devLog(
          `result:save ok (sample=${result.data.sampleId}, issues=${result.data.issueCount}, ` +
            `expr=${result.data.expressionId ?? 'none'}, original=${result.data.savedOriginal})`,
        );
      } else {
        devLog('result:save fail:', result.error.debug ?? result.error.message);
      }
      return result;
    } catch (e) {
      devLog('result:save error:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
