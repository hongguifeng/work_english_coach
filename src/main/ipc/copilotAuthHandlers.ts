import { ipcMain } from 'electron';
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { CopilotLoginInfo } from '../../shared/types/settings';
import type { CopilotModel } from '../services/copilotAuthService';
import { classifyError } from '../db/errors';
import {
  clearCopilotAuth,
  listCopilotModels,
  pollCopilotGitHubToken,
  refreshCopilotToken,
  requestCopilotDeviceCode,
  saveCopilotAuth,
} from '../services/copilotAuthService';
import { getSharedSecretBackend } from '../services/secretService';

let pendingDeviceCode: Awaited<ReturnType<typeof requestCopilotDeviceCode>> extends Result<infer T>
  ? T | null
  : never = null;

function errorResult(error: unknown): Result<never> {
  const classified = classifyError(error);
  return err(classified.code, classified.message, classified.debug);
}

export function registerCopilotAuthIpc(): void {
  ipcMain.handle('copilot:begin-login', async (): Promise<Result<CopilotLoginInfo>> => {
    const result = await requestCopilotDeviceCode();
    if (!result.ok) return result;
    pendingDeviceCode = result.data;
    return ok({
      userCode: result.data.user_code,
      verificationUri: result.data.verification_uri,
    });
  });

  ipcMain.handle('copilot:complete-login', async (): Promise<Result<void>> => {
    if (!pendingDeviceCode) return err('config', '请先获取 GitHub 登录验证码');
    const deviceCode = pendingDeviceCode;
    pendingDeviceCode = null;
    try {
      const githubToken = await pollCopilotGitHubToken(deviceCode);
      if (!githubToken.ok) return githubToken;
      const copilotToken = await refreshCopilotToken(githubToken.data);
      if (!copilotToken.ok) return copilotToken;
      return saveCopilotAuth(getSharedSecretBackend(), copilotToken.data);
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle('copilot:logout', async (): Promise<Result<void>> =>
    clearCopilotAuth(getSharedSecretBackend()));

  ipcMain.handle('copilot:is-configured', async (): Promise<Result<boolean>> => {
    try {
      const backend = getSharedSecretBackend();
      const value = await backend.get('githubCopilotAuth');
      return ok(value !== null && value.length > 0);
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle('copilot:list-models', async (): Promise<Result<CopilotModel[]>> =>
    listCopilotModels(getSharedSecretBackend()));
}