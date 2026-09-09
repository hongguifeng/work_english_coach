// T022 — 草稿检查 AI 分析服务（主进程内部）
//
// 职责（docs/04 §4-5、docs/08 T022）：
// - 把渲染进程提交的草稿输入（Zod 校验）交给 AI，得到结构化纠错结果
//   （AnalyzeDraftResult，经 T021 的 Zod Schema 校验）。
// - 支持取消：每个请求用独立 AbortController，按 requestId 注册，
//   cancelAiAnalysis(requestId) 触发外部 abort → AI 客户端返回 code='canceled'。
// - 安全：API Key 只在主进程内部（凭据存储），绝不经过 IPC；
//   非法输入不会发送到 AI（先 Zod 校验）；AI 非法输出返回 parse 错误（优雅失败）。
//
// 本模块 electron-free（只依赖 db repository / secretBackend 抽象 / AI 客户端接口），
// 可在纯 Node 下用 node:sqlite + FakeSecretBackend + MockAiClient 测试。
// 提示词（T023）：系统 + 用户 Prompt 统一放在 aiPrompts.ts（docs/04 §4/§5 完整模板）。
import type { Result } from '../../shared/types/app';
import type { AnalyzeDraftResult } from '../../shared/types/ai';
import type { SettingsRepository } from '../db/repositories/settings';
import { buildAiRequestConfig } from './aiConfigService';
import { OpenAICompatibleClient, type AiClient } from './aiClient';
import { parseAnalyzeDraftInput, parseDraftAnalysis } from './aiSchemas';
import {
  buildCorrectionSystemPrompt,
  buildCorrectionUserPrompt,
} from './aiPrompts';
import type { SecretBackend } from './secretBackend';

/** AI 分析服务的依赖注入（便于单测替换 DB / 凭据 / AI 客户端）。 */
export interface AiAnalysisDeps {
  getSettingsRepo: () => SettingsRepository;
  getSecretBackend: () => SecretBackend;
  /** 可选的 AI 客户端注入；默认 OpenAICompatibleClient。 */
  client?: AiClient;
}

/** 活跃请求注册表：requestId → AbortController（供 cancelAiAnalysis 取消）。 */
const activeRequests = new Map<string, AbortController>();

/**
 * 取消一个进行中的 AI 请求（按 requestId）。
 * @returns 是否存在并已触发中止（不存在返回 false，调用方可据此忽略）。
 */
export function cancelAiAnalysis(requestId: string): boolean {
  const controller = activeRequests.get(requestId);
  if (controller === undefined) return false;
  controller.abort();
  activeRequests.delete(requestId);
  return true;
}

/**
 * 执行一次草稿检查（T022）。
 * 流程：① 校验输入 → ② 组装 AI 请求配置 → ③ 调 AI（可取消）→ ④ Zod 解析。
 * 任何一步失败都返回统一 Result，绝不抛异常到 IPC 层。
 */
export async function analyzeDraft(
  input: unknown,
  requestId: string,
  deps: AiAnalysisDeps,
): Promise<Result<AnalyzeDraftResult>> {
  // ① 入参校验（非法输入不会发送到 AI）
  const validated = parseAnalyzeDraftInput(input);
  if (!validated.ok) return validated;

  // ② 组装 AI 请求配置（读 settings + 凭据存储的 API Key）
  const config = await buildAiRequestConfig(deps.getSettingsRepo(), deps.getSecretBackend());
  if (!config.ok) return config;

  // ③ 调 AI（可取消）
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const client = deps.client ?? new OpenAICompatibleClient();
  try {
    const chat = await client.chat(
      config.data,
      [
        { role: 'system', content: buildCorrectionSystemPrompt() },
        { role: 'user', content: buildCorrectionUserPrompt(validated.data) },
      ],
      controller.signal,
    );
    if (!chat.ok) return chat; // timeout / canceled / network / ...

    // ④ Zod 解析 AI 输出（非法结构 → parse 错误，优雅失败）
    return parseDraftAnalysis(chat.data);
  } finally {
    activeRequests.delete(requestId);
  }
}

/** 仅供单测：清空活跃请求注册表，避免用例间串扰。 */
export function __resetActiveRequestsForTest(): void {
  activeRequests.clear();
}
