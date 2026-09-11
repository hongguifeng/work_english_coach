// T038 — 全局快捷键 IPC（主进程）
//
// 暴露的渠道：
//   shortcut:get   读取快捷键设置 + 当前注册状态（失败原因，如有）
//   shortcut:save  校验并持久化快捷键设置，并重新注册（或解注册）
//
// 规则（docs/08 T038）：
// - 注册冲突 / 失败绝不抛异常：handler 一律返回 Result，失败信息经设置页展示；
// - 本文件持有 electron 绑定（globalShortcut 后端在 index.ts 绑定进 service）。
import { ipcMain } from 'electron';
import { err } from '../../shared/types/app';
import type { ErrResult, Result } from '../../shared/types/app';
import type { GlobalShortcutState } from '../../shared/types/settings';
import { getDatabase } from '../db/database';
import { classifyError } from '../db/errors';
import { SettingsRepository } from '../db/repositories/settings';
import { devLog } from '../log';
import { shortcutGet, shortcutSave } from '../services/shortcutService';

function errFromUnknown(e: unknown): ErrResult {
  const a = classifyError(e);
  return err(a.code, a.message, a.debug);
}

export function registerShortcutIpc(): void {
  ipcMain.handle('shortcut:get', (): Result<GlobalShortcutState> => {
    try {
      return shortcutGet(new SettingsRepository(getDatabase()));
    } catch (e) {
      devLog('shortcut:get fail:', e instanceof Error ? e.message : String(e));
      return errFromUnknown(e);
    }
  });

  ipcMain.handle(
    'shortcut:save',
    (_e, input: unknown): Result<GlobalShortcutState> => {
      try {
        const r = shortcutSave(new SettingsRepository(getDatabase()), input);
        if (r.ok) {
          devLog(
            `shortcut:save ok (enabled=${r.data.settings.enabled}, accelerator=${r.data.settings.accelerator}, active=${r.data.active}${r.data.error ? `, error=${r.data.error}` : ''})`,
          );
        } else {
          devLog('shortcut:save fail:', r.error.debug ?? r.error.message);
        }
        return r;
      } catch (e) {
        devLog('shortcut:save fail:', e instanceof Error ? e.message : String(e));
        return errFromUnknown(e);
      }
    },
  );
}
