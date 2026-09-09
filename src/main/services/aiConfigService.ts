// T019 — AI 非密钥配置服务（electron-free，可在纯 Node 下测试）
//
// 职责（docs/02 §8、docs/08 T019）：
// - 把非密钥 AI 设置（baseUrl/model/timeout/saveOriginal/redactEnabled）持久化到
//   SQLite `settings` 表（key = `aiSettings`，value = JSON）。
// - 默认值：读不到 / JSON 损坏 / 字段非法时，回退到 DEFAULT_AI_SETTINGS（fail-safe），
//   保证应用重启后配置仍可用且不会因脏数据崩溃。
// - 校验：保存前用共享 aiSettingsSchema（Zod）校验 Base URL、模型、超时等，
//   非法输入返回 validation 错误，绝不写入脏数据。
// - API Key 不属于本服务：它在 Windows 凭据存储（T018）。`buildAiRequestConfig`
//   是主进程内部助手，把“已校验配置 + 从凭据存储读取的 Key”组装成 T020 AI 客户端
//   需要的请求上下文；Key 缺失时返回 config 错误。它从不通过 IPC 暴露给渲染进程。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import {
  aiSettingsSchema,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
} from '../../shared/types/settings';
import { classifyError } from '../db/errors';
import type { SettingsRepository } from '../db/repositories/settings';
import { readApiKey } from './secretService';
import type { SecretBackend } from './secretBackend';

/** `settings` 表中存放 AI 非密钥配置的键。 */
export const AI_CONFIG_KEY = 'aiSettings';

/**
 * T020 AI 客户端所需的请求上下文（主进程内部用，绝不发给渲染进程）。
 * `timeoutMs` 由秒换算而来，便于直接传给 fetch/超时控制。
 */
export interface AiRequestConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey: string;
}

/**
 * 读取已持久化的 AI 配置。
 * 缺失 / JSON 损坏 / 字段非法时，安全回退到 DEFAULT_AI_SETTINGS（不抛错）。
 */
export function loadAiConfig(repo: SettingsRepository): AiSettings {
  const res = repo.get(AI_CONFIG_KEY);
  if (!res.ok) return { ...DEFAULT_AI_SETTINGS };
  const row = res.data;
  if (!row || row.value.length === 0) return { ...DEFAULT_AI_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as unknown;
    const check = aiSettingsSchema.safeParse(parsed);
    if (check.success) return check.data;
    return { ...DEFAULT_AI_SETTINGS };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/**
 * 校验并持久化 AI 配置。
 * - 入参未知类型 → 用 aiSettingsSchema 校验；非法返回 validation（不写库）。
 * - 合法 → 序列化为 JSON 写入 `settings` 表，返回保存后的配置。
 */
export function saveAiConfig(
  repo: SettingsRepository,
  input: unknown,
): Result<AiSettings> {
  const parsed = aiSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err('validation', issue ? issue.message : 'AI 设置不合法');
  }
  const res = repo.set(AI_CONFIG_KEY, JSON.stringify(parsed.data));
  if (res.ok) return ok(parsed.data);
  return res; // ErrResult（存储错误）
}

/**
 * 主进程内部助手（T020 用）：组装“已校验配置 + 凭据存储中的 API Key”。
 * - Key 未配置 → 返回 config 错误（提示用户先去设置页保存）。
 * - 凭据后端故障 → 归类后经统一 Result 返回，错误信息不含 Key 原文。
 * 本函数只在主进程调用，绝不通过 IPC 暴露。
 */
export async function buildAiRequestConfig(
  repo: SettingsRepository,
  backend: SecretBackend,
): Promise<Result<AiRequestConfig>> {
  const settings = loadAiConfig(repo);
  let key: string | null = null;
  try {
    key = await readApiKey(backend);
  } catch (e) {
    const a = classifyError(e);
    return err(
      a.code,
      '读取 API Key 失败，请检查系统凭据存储',
      a.debug,
    );
  }
  if (key === null || key.trim() === '') {
    return err('config', 'API Key 未配置，请先在设置页保存');
  }
  return ok({
    baseUrl: settings.baseUrl,
    model: settings.model,
    timeoutMs: settings.timeoutSeconds * 1000,
    apiKey: key,
  });
}
