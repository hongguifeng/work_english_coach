import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import { classifyError } from '../db/errors';
import type { SecretBackend } from './secretBackend';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
export const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
export const COPILOT_MODELS_URL = `${COPILOT_BASE_URL}/models`;
export const GITHUB_COPILOT_ACCOUNT = 'githubCopilotAuth';
export const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

const USER_AGENT = 'workenglish-coach/0.1.0';
const COPILOT_AUTH_SCOPE = 'read:user';

export interface CopilotDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

export interface CopilotAuth {
  githubAccessToken: string;
  copilotToken: string;
  copilotTokenExpiresAt: number;
}

export interface CopilotAuthFetchOptions {
  fetchImpl?: typeof fetch;
  clientId?: string;
}

function jsonHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    throw new Error('GitHub 返回了无法解析的响应');
  }
}

function clientId(options: CopilotAuthFetchOptions): string {
  return options.clientId ?? process.env.GITHUB_COPILOT_CLIENT_ID ?? GITHUB_COPILOT_CLIENT_ID;
}

function isExpired(expiresAt: number): boolean {
  return !expiresAt || Date.now() > expiresAt - 60_000;
}

function messageFrom(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error_description === 'string'
    ? data.error_description
    : typeof data.message === 'string'
      ? data.message
      : typeof data.error === 'string'
        ? data.error
        : fallback;
}

export async function requestCopilotDeviceCode(
  options: CopilotAuthFetchOptions = {},
): Promise<Result<CopilotDeviceCode>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: jsonHeaders(),
      body: new URLSearchParams({
        client_id: clientId(options),
        scope: COPILOT_AUTH_SCOPE,
      }),
    });
    const data = await readJson(response);
    if (!response.ok) return err('network', messageFrom(data, '无法请求 GitHub 登录验证码'));
    if (
      typeof data.device_code !== 'string' ||
      typeof data.user_code !== 'string' ||
      typeof data.verification_uri !== 'string' ||
      typeof data.expires_in !== 'number'
    ) {
      return err('parse', 'GitHub 登录响应缺少设备验证码');
    }
    return ok(data as unknown as CopilotDeviceCode);
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '请求 GitHub 登录验证码失败', classified.debug);
  }
}

export async function pollCopilotGitHubToken(
  deviceCode: CopilotDeviceCode,
  options: CopilotAuthFetchOptions = {},
  signal?: AbortSignal,
): Promise<Result<string>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let intervalMs = Math.max(1, deviceCode.interval ?? 5) * 1000;
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('登录已取消'));
      }, { once: true });
    }).catch(() => undefined);
    if (signal?.aborted) return err('canceled', 'GitHub 登录已取消');

    try {
      const response = await fetchImpl(GITHUB_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: jsonHeaders(),
        body: new URLSearchParams({
          client_id: clientId(options),
          device_code: deviceCode.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
        signal,
      });
      const data = await readJson(response);
      if (typeof data.access_token === 'string') return ok(data.access_token);
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') {
        intervalMs += 5_000;
        continue;
      }
      if (data.error === 'expired_token') return err('timeout', 'GitHub 登录验证码已过期，请重新登录');
      return err('config', messageFrom(data, 'GitHub 登录失败'));
    } catch (error) {
      if (signal?.aborted) return err('canceled', 'GitHub 登录已取消');
      const classified = classifyError(error);
      return err(classified.code, '轮询 GitHub 登录状态失败', classified.debug);
    }
  }
  return err('timeout', 'GitHub 登录验证码已过期，请重新登录');
}

export async function refreshCopilotToken(
  githubAccessToken: string,
  options: CopilotAuthFetchOptions = {},
): Promise<Result<CopilotAuth>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(COPILOT_TOKEN_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `token ${githubAccessToken}`,
        'User-Agent': USER_AGENT,
      },
    });
    const data = await readJson(response);
    if (!response.ok || typeof data.token !== 'string' || typeof data.expires_at !== 'number') {
      return err('config', messageFrom(data, '获取 Copilot token 失败，请确认 GitHub 账户有 Copilot 订阅'));
    }
    return ok({
      githubAccessToken,
      copilotToken: data.token,
      copilotTokenExpiresAt: data.expires_at * 1000,
    });
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '获取 Copilot token 失败', classified.debug);
  }
}

export async function saveCopilotAuth(
  backend: SecretBackend,
  auth: CopilotAuth,
): Promise<Result<void>> {
  try {
    await backend.set(GITHUB_COPILOT_ACCOUNT, JSON.stringify(auth));
    return ok(undefined);
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '保存 GitHub Copilot 登录状态失败', classified.debug);
  }
}

export async function readCopilotAuth(backend: SecretBackend): Promise<CopilotAuth | null> {
  const value = await backend.get(GITHUB_COPILOT_ACCOUNT);
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as CopilotAuth).githubAccessToken === 'string' &&
      typeof (parsed as CopilotAuth).copilotToken === 'string' &&
      typeof (parsed as CopilotAuth).copilotTokenExpiresAt === 'number'
    ) return parsed as CopilotAuth;
  } catch {
    return null;
  }
  return null;
}

export async function ensureCopilotAuth(
  backend: SecretBackend,
  options: CopilotAuthFetchOptions = {},
): Promise<Result<CopilotAuth>> {
  try {
    const cached = await readCopilotAuth(backend);
    if (cached && !isExpired(cached.copilotTokenExpiresAt)) return ok(cached);
    if (!cached) return err('config', '尚未登录 GitHub Copilot，请先在设置页登录');
    const refreshed = await refreshCopilotToken(cached.githubAccessToken, options);
    if (!refreshed.ok) return refreshed;
    const saved = await saveCopilotAuth(backend, refreshed.data);
    return saved.ok ? refreshed : err(saved.error.code, saved.error.message, saved.error.debug);
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '读取 GitHub Copilot 登录状态失败', classified.debug);
  }
}

export async function clearCopilotAuth(backend: SecretBackend): Promise<Result<void>> {
  try {
    await backend.delete(GITHUB_COPILOT_ACCOUNT);
    return ok(undefined);
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '退出 GitHub Copilot 失败', classified.debug);
  }
}

export interface CopilotModel {
  id: string;
  name: string;
}

/** 获取当前订阅实际可用的 Copilot 模型；token 始终只在主进程使用。 */
export async function listCopilotModels(
  backend: SecretBackend,
  options: CopilotAuthFetchOptions = {},
): Promise<Result<CopilotModel[]>> {
  const auth = await ensureCopilotAuth(backend, options);
  if (!auth.ok) return auth;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(COPILOT_MODELS_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.data.copilotToken}`,
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'vscode/1.91.0',
        'User-Agent': USER_AGENT,
      },
    });
    const data = await readJson(response);
    if (!response.ok) {
      return err('config', messageFrom(data, '获取 Copilot 模型列表失败'));
    }
    const rawModels = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const models = rawModels.flatMap((raw): CopilotModel[] => {
      if (typeof raw === 'string') return [{ id: raw, name: raw }];
      if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'string') return [];
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : raw.id;
      return [{ id: raw.id, name }];
    });
    if (models.length === 0) return err('parse', 'Copilot 返回的模型列表为空或格式无法识别');
    return ok(models);
  } catch (error) {
    const classified = classifyError(error);
    return err(classified.code, '获取 Copilot 模型列表失败', classified.debug);
  }
}