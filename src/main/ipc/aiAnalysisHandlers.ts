// T022 — 草稿检查 IPC（主进程）
//
// 暴露的渠道：
//   ai:analyze-draft     提交草稿（中文原意 + 英文草稿 + 场景/对象/语气）→ 结构化纠错结果
//   ai:analyze-draft-cancel  按 requestId 取消进行中的请求
//
// 安全与规则（docs/02、docs/06、docs/08 T022）：
// - 入参先经 Zod 校验（非法输入不会发送到 AI）；AI 输出再经 Zod 校验（非法 → parse 错误）。
// - API Key 只在主进程内部（凭据存储），从不经过本模块或 IPC 返回给渲染进程。
// - 所有渠道返回统一 Result<T>；异常经 classifyError 归类，绝不把原始堆栈抛给 UI。
// - 日志只记录 requestId 与结果码，不记录完整工作文本或密钥。
import { ipcMain } from 'electron';
import { err, ok } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { AnalyzeDraftResult } from '../../shared/types/ai';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { SettingsRepository } from '../db/repositories/settings';
import { devLog } from '../log';
import { analyzeDraft, cancelAiAnalysis } from '../services/aiAnalysisService';
import { getSharedSecretBackend } from '../services/secretService';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerAiAnalysisIpc(): void {
  ipcMain.handle(
    'ai:analyze-draft',
    async (_e, input: unknown, requestId: string): Promise<Result<AnalyzeDraftResult>> => {
      const deps = {
        getSettingsRepo: () => new SettingsRepository(getDatabase()),
        getSecretBackend: () => getSharedSecretBackend(),
      };
      try {
        const r = await analyzeDraft(input, requestId, deps);
        // 只记录结果码，不记录完整工作文本（避免敏感内容进日志）
        devLog(`ai:analyze-draft (${requestId}) -> ${r.ok ? 'ok' : r.error.code}`);
        return r;
      } catch (e) {
        devLog('ai:analyze-draft fail:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );

  ipcMain.handle('ai:analyze-draft-cancel', (_e, requestId: string): Result<boolean> => {
    try {
      const done = cancelAiAnalysis(requestId);
      devLog(`ai:analyze-draft-cancel (${requestId}) -> ${done}`);
      return ok(done);
    } catch (e) {
      devLog('ai:analyze-draft-cancel fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });
}
