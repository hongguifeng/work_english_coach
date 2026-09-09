// T019 — AI 非密钥配置 IPC（主进程）
//
// 暴露的渠道：
//   aiConfig:get   读取已持久化的 AI 配置（缺失/损坏 → 默认值；绝不含 API Key）
//   aiConfig:save  校验并持久化 AI 配置（非法输入 → validation 错误；绝不含 API Key）
//
// 安全与规则（docs/02、docs/06）：
// - API Key 永远不经过本模块（走 Windows 凭据存储，T018）；这里只搬运非密钥设置。
// - 所有渠道返回统一 Result<T>；异常经 classifyError 归类，绝不把原始堆栈抛给 UI。
// - 日志只记录 model / baseUrl / timeout，不记录任何密钥或完整工作文本。
import { ipcMain } from 'electron';
import { err, ok } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { AiSettings } from '../../shared/types/settings';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { SettingsRepository } from '../db/repositories/settings';
import { devLog } from '../log';
import { loadAiConfig, saveAiConfig } from '../services/aiConfigService';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerAiConfigIpc(): void {
  ipcMain.handle('aiConfig:get', (): Promise<Result<AiSettings>> => {
    try {
      const settings = loadAiConfig(new SettingsRepository(getDatabase()));
      return Promise.resolve(ok(settings));
    } catch (e) {
      devLog('aiConfig:get fail:', e instanceof Error ? e.message : String(e));
      return Promise.resolve(errFromUnknown(e));
    }
  });

  ipcMain.handle(
    'aiConfig:save',
    (_e, input: unknown): Promise<Result<AiSettings>> => {
      try {
        const r = saveAiConfig(new SettingsRepository(getDatabase()), input);
        if (r.ok) {
          devLog(
            `aiConfig:save ok (model=${r.data.model}, baseUrl=${r.data.baseUrl}, timeout=${r.data.timeoutSeconds}s, saveOriginal=${r.data.saveOriginal}, redact=${r.data.redactEnabled})`,
          );
        } else {
          devLog('aiConfig:save fail:', r.error.debug ?? r.error.message);
        }
        return Promise.resolve(r);
      } catch (e) {
        devLog('aiConfig:save fail:', e instanceof Error ? e.message : String(e));
        return Promise.resolve(errFromUnknown(e));
      }
    },
  );
}
