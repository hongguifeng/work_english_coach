// T018 — API Key 存取服务（主进程内部，Electron 无关，便于测试）
//
// 安全原则（docs/01 §5.5、docs/02、docs/06）：
// - API Key 只存放在 OS 凭据存储（keytar/DPAPI），绝不写入 SQLite、绝不进入日志。
// - 本服务只在“主进程内部”使用：
//     - readApiKey 供 AI 客户端（T020）在构造请求时取用，从不通过 IPC 返回给渲染进程；
//     - 渲染进程只能通过 secret:is-configured 得知“是否已配置”（布尔值）。
// - 任何错误都用统一 Result 表达，且错误信息绝不含 Key 原文。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import { classifyError } from '../db/errors';
import type { SecretBackend } from './secretBackend';

/** keytar 命名空间（应用名）。 */
export const SECRET_SERVICE = 'WorkEnglish Coach';
/** 本应用的 API Key 凭据账户名。 */
export const AI_API_KEY_ACCOUNT = 'aiApiKey';
/** API Key 最大长度（防御异常输入，避免凭据存储滥用）。 */
export const MAX_API_KEY_LENGTH = 512;

/** 校验并规范化输入；返回 ok(原始 Key) 或 validation 错误。 */
function validateKey(input: unknown): Result<string> {
  if (typeof input !== 'string') {
    return err('validation', 'API Key 必须是字符串');
  }
  if (input.length === 0 || input.trim().length === 0) {
    return err('validation', 'API Key 不能为空');
  }
  if (input.length > MAX_API_KEY_LENGTH) {
    return err('validation', `API Key 过长（最多 ${MAX_API_KEY_LENGTH} 个字符）`);
  }
  return ok(input);
}

/**
 * 保存 API Key 到系统凭据存储。
 * 输入非法 → validation 错误；后端失败 → 归类错误（信息不含 Key）。
 */
export async function saveApiKey(
  backend: SecretBackend,
  input: unknown,
): Promise<Result<void>> {
  const v = validateKey(input);
  if (!v.ok) return v;
  try {
    await backend.set(AI_API_KEY_ACCOUNT, v.data);
    return ok(undefined);
  } catch (e) {
    const a = classifyError(e);
    return err(a.code, a.message, a.debug);
  }
}

/**
 * 读取 API Key（仅主进程内部使用，例如 AI 客户端构造请求头）。
 * 不存在时返回 null。本函数不经过 IPC，Key 不会到达渲染进程。
 */
export async function readApiKey(backend: SecretBackend): Promise<string | null> {
  return backend.get(AI_API_KEY_ACCOUNT);
}

/** 清除 API Key（幂等：本就未配置时也返回成功）。 */
export async function clearApiKey(backend: SecretBackend): Promise<Result<void>> {
  try {
    await backend.delete(AI_API_KEY_ACCOUNT);
    return ok(undefined);
  } catch (e) {
    const a = classifyError(e);
    return err(a.code, a.message, a.debug);
  }
}

/**
 * 查询是否已配置 API Key（渲染进程可见的唯一“状态”信息）。
 * 只返回布尔值；读取失败按“未配置”处理（不抛错、不泄漏细节）。
 */
export async function isApiKeyConfigured(backend: SecretBackend): Promise<boolean> {
  try {
    const v = await backend.get(AI_API_KEY_ACCOUNT);
    return v !== null && v.length > 0;
  } catch {
    return false;
  }
}
