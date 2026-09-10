// T042 — AI 连接测试服务（设置页「测试连接」，主进程内部）
//
// 职责（docs/08 T042、docs/01 §5.5、docs/06）：
// - 用设置页表单「当前」的 Base URL / 模型 / 超时（未保存也能测）发起一次真实
//   `POST {baseUrl}/chat/completions` 最小调用（prompt 只要求回复 "pong"），
//   验证用户即将保存/正在使用的 AI 端点真实可用。
// - 与产品实际使用的同一通道（而非 /v1/models）：测试通过 ⇒ 纠错/复习评价可用。
// - 安全：API Key 只在主进程内部（凭据存储），绝不经过 IPC；响应内容丢弃
//   （不展示、不存储、不进日志）；只返回耗时 latencyMs。
// - 统一失败语义（继承 T020 AiClient 的 AppError 分类）：
//     * 输入非法（未过 Zod）      -> validation（不发送 AI）
//     * API Key 未配置            -> config
//     * 网络不可达 / 非 2xx 等     -> network（401/403 → config）
//     * 超时                      -> timeout
//     * 200 但结构缺失 content    -> parse（真实纠错调用同样会失败，故判失败正确）
//
// 本模块 electron-free（只依赖 secretBackend 抽象 / AI 客户端接口），
// 可在纯 Node 下用 FakeSecretBackend + MockAiClient 测试。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import type { AiConnectionTestResult } from '../../shared/types/settings';
import { readApiKey } from './secretService';
import type { SecretBackend } from './secretBackend';
import { OpenAICompatibleClient, type AiClient } from './aiClient';
import { parseAiConnectionTestInput } from './aiSchemas';
import { COPILOT_BASE_URL, ensureCopilotAuth } from './copilotAuthService';

/** 测试连接服务的依赖注入（便于单测替换凭据后端 / AI 客户端）。 */
export interface AiConnectionTestDeps {
  getSecretBackend: () => SecretBackend;
  /** 可选的 AI 客户端注入；默认 OpenAICompatibleClient（真实 fetch）。 */
  client?: AiClient;
}

/** 最小连通性 Prompt（T042）：系统 + 用户，只要求回复一个词，尽量省 token。 */
const CONNECT_TEST_SYSTEM_PROMPT =
  'You are a connectivity probe. Reply with the single word: pong';
const CONNECT_TEST_USER_PROMPT = 'ping';

/**
 * 执行一次 AI 连接测试（T042）。
 * 流程：① 校验输入 → ② 读凭据存储的 API Key → ③ 真实 chat 调用（丢弃内容）。
 * 任何一步失败都返回统一 Result，绝不抛异常到 IPC 层。
 */
export async function testAiConnection(
  input: unknown,
  deps: AiConnectionTestDeps,
): Promise<Result<AiConnectionTestResult>> {
  // ① 入参校验（非法输入不会发送到 AI）
  const validated = parseAiConnectionTestInput(input);
  if (!validated.ok) return validated;

  // ② 从系统凭据存储读取 API Key（绝不过 IPC；未配置 → config）
  let key: string | null = null;
  const provider = validated.data.provider;
  let baseUrl = validated.data.baseUrl;
  try {
    if (provider === 'githubCopilot') {
      const auth = await ensureCopilotAuth(deps.getSecretBackend());
      if (!auth.ok) return auth;
      key = auth.data.copilotToken;
      baseUrl = COPILOT_BASE_URL;
    } else {
      key = await readApiKey(deps.getSecretBackend());
    }
  } catch {
    return err('storage', '读取 AI 凭据失败，请检查系统凭据存储');
  }
  if (key === null || key.trim() === '') {
    return err('config', provider === 'githubCopilot'
      ? '尚未登录 GitHub Copilot，请先在本页登录'
      : 'API Key 未配置，请先在本页保存 API Key 后再测试');
  }

  // ③ 真实调用（与纠错/评价同一 /chat/completions 通道；内容丢弃，只取耗时）
  const client = deps.client ?? new OpenAICompatibleClient();
  const started = Date.now();
  const chat = await client.chat(
    {
      provider,
      baseUrl,
      model: validated.data.model,
      timeoutMs: validated.data.timeoutSeconds * 1000,
      reasoningEffort: validated.data.reasoningEffort ?? 'none',
      apiKey: key,
    },
    [
      { role: 'system', content: CONNECT_TEST_SYSTEM_PROMPT },
      { role: 'user', content: CONNECT_TEST_USER_PROMPT },
    ],
  );

  if (!chat.ok) {
    // 客户端已按 AppError 分类（network/timeout/config/parse/canceled）
    return chat;
  }

  // 成功：只返回耗时（响应内容故意丢弃，不展示、不存储、不进日志）
  return ok({ latencyMs: Date.now() - started });
}
