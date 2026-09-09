// T028 — 复习任务生成 IPC（主进程）
//
// 暴露的渠道：
//   review:generate-task  从知识点/表达生成一道新练习（调 AI）→ 写入 review_tasks
//
// 安全与规则（docs/02、docs/06、docs/08 T028）：
// - 入参在 IPC 边界用 Zod 校验；非法 → validation 错误。
// - AI 输出再经 Zod 校验（非法 → parse 错误，不写库）。
// - API Key 只在主进程内部（凭据存储），从不经过 IPC 返回给渲染进程。
// - 返回统一 Result<ReviewTaskGeneratedView>；日志只记录结果码，不记录练习原文。
import { ipcMain } from 'electron';
import { z } from 'zod';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { ReviewGenerateTaskInput, ReviewTaskGeneratedView } from '../../shared/types/review';
import { REVIEW_TASK_TYPES } from '../services/aiSchemas';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { createRepositories } from '../db/repositories';
import { SettingsRepository } from '../db/repositories/settings';
import { generateReviewTask, rowToTaskView } from '../services/reviewTaskService';
import { getSharedSecretBackend } from '../services/secretService';
import { devLog } from '../log';

const reviewGenerateInputSchema = z.object({
  source: z.enum(['skill', 'expression']),
  id: z.string().min(1),
  taskType: z.enum(REVIEW_TASK_TYPES).optional(),
});

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerReviewTaskIpc(): void {
  ipcMain.handle(
    'review:generate-task',
    async (_e, raw: unknown): Promise<Result<ReviewTaskGeneratedView>> => {
      const parsed = reviewGenerateInputSchema.safeParse(raw);
      if (!parsed.success) {
        return err('validation', '复习任务生成参数非法: ' + parsed.error.issues[0]?.message);
      }
      const input: ReviewGenerateTaskInput = parsed.data;
      const deps = {
        getSettingsRepo: () => new SettingsRepository(getDatabase()),
        getSecretBackend: () => getSharedSecretBackend(),
      };
      try {
        const r = await generateReviewTask(input, createRepositories(getDatabase()), deps);
        if (r.ok) {
          // 只记录结果码与去重标志，不记录练习原文（避免敏感工作文本进日志）
          devLog(`review:generate-task -> ok (created=${r.data.created})`);
          return { ok: true, data: { created: r.data.created, task: rowToTaskView(r.data.task) } };
        }
        devLog(`review:generate-task -> ${r.error.code}`);
        return r;
      } catch (e) {
        devLog('review:generate-task fail:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );
}
