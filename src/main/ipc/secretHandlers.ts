// T018 — API Key 凭据 IPC（主进程）
//
// 暴露的渠道（渲染进程可见面最小化）：
//   secret:set          保存 API Key 到系统凭据存储（keytar/DPAPI）
//   secret:clear        清除 API Key（幂等）
//   secret:is-configured 查询是否已配置（只返回布尔，绝不返回 Key 原文）
//
// 规则（docs/02、docs/06）：
// - 渲染进程永远拿不到原始 Key；也没有“读取 Key”的渠道（供 AI 客户端用的
//   readApiKey 只在主进程内部调用，不走 IPC）。
// - 所有渠道返回统一 Result<T>；异常经 classifyError 归类，绝不把原始堆栈抛给 UI。
// - 日志只记录“是否配置 / Key 长度”，绝不记录 Key 内容。
// - keytar 后端惰性创建（首次调用才加载原生模块），避免启动即失败。
import { ipcMain } from 'electron';
import { err, ok } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import { classifyError } from '../db/errors';
import { devLog } from '../log';
import {
  AI_API_KEY_ACCOUNT,
  clearApiKey,
  getSharedSecretBackend,
  isApiKeyConfigured,
  saveApiKey,
} from '../services/secretService';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerSecretIpc(): void {
  ipcMain.handle('secret:set', async (_e, key: unknown): Promise<Result<void>> => {
    try {
      const r = await saveApiKey(getSharedSecretBackend(), key);
      if (r.ok) {
        // 只记录长度，不记录内容
        const len = typeof key === 'string' ? key.length : 0;
        devLog(`secret:set ok (account=${AI_API_KEY_ACCOUNT}, keyLen=${len})`);
      } else {
        devLog('secret:set fail:', r.error.debug ?? r.error.message);
      }
      return r;
    } catch (e) {
      devLog('secret:set fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle('secret:clear', async (): Promise<Result<void>> => {
    try {
      const r = await clearApiKey(getSharedSecretBackend());
      if (r.ok) {
        devLog('secret:clear ok');
      } else {
        devLog('secret:clear fail:', r.error.debug ?? r.error.message);
      }
      return r;
    } catch (e) {
      devLog('secret:clear fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle(
    'secret:is-configured',
    async (): Promise<Result<boolean>> => {
      try {
        return ok(await isApiKeyConfigured(getSharedSecretBackend()));
      } catch (e) {
        devLog('secret:is-configured fail:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );
}
