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
// （T023 会把 buildPrompt 换成 docs/04 §4/§5 的完整提示词模板。）
import type { Result } from '../../shared/types/app';
import type { AnalyzeDraftInput, AnalyzeDraftResult } from '../../shared/types/ai';
import type { SettingsRepository } from '../db/repositories/settings';
import { buildAiRequestConfig } from './aiConfigService';
import { OpenAICompatibleClient, type AiClient } from './aiClient';
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  parseAnalyzeDraftInput,
  parseDraftAnalysis,
} from './aiSchemas';
import {
  AUDIENCE_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  TONE_OPTIONS,
} from '../../shared/constants/scenes';
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

/** 把枚举值映射回中文标签（用于给 AI 的提示词，更贴近用户语境）。 */
function labelOf(opts: { value: string; label: string }[], value: string): string {
  return opts.find((o) => o.value === value)?.label ?? value;
}

/**
 * 组装发给 AI 的消息（T022 的紧凑版；T023 换成 docs/04 §4/§5 完整模板）。
 * system = 角色与硬约束；user = 场景/对象/语气 + 中文原意 + 英文草稿 + 额外要求。
 */
function buildPrompt(input: AnalyzeDraftInput): { system: string; user: string } {
  const system = [
    '你是一位资深职场英语教练。用户给出中文原意和英文草稿，请：',
    '1) 找出主要问题（区分：语法错误 / 用词或搭配建议 / 语气风险 / 意思不明确）；',
    '2) 给出 minimalRevision（最小修改版：只改错、尽量保留原句）与 naturalRevision（自然表达版）；',
    '3) 提炼一个最值得记住的知识点 keyLearningPoint，并设计一道换场景练习 practice。',
    '严格规则：不得改变日期、数字、人名、责任人、承诺程度；不替用户承诺他没说的内容。',
    '只返回符合给定 JSON Schema 的 JSON，不要输出额外解释文字。',
  ].join('\n');

  const parts: string[] = [];
  parts.push(`【场景】${labelOf(SOURCE_TYPE_OPTIONS, input.sourceType)}`);
  parts.push(`【对象】${labelOf(AUDIENCE_OPTIONS, input.audience)}`);
  parts.push(`【语气】${labelOf(TONE_OPTIONS, input.tone)}`);
  if (input.originalChinese && input.originalChinese.length > 0) {
    parts.push(`【中文原意】${input.originalChinese}`);
  }
  parts.push(`【英文草稿】${input.originalEnglish}`);
  if (input.extraInstruction && input.extraInstruction.length > 0) {
    parts.push(`【额外要求】${input.extraInstruction}`);
  }
  const categoryList = ISSUE_CATEGORIES.join('|');
  const severityList = ISSUE_SEVERITIES.join('|');
  parts.push(
    '请只返回 JSON（不要额外文字）。字段与结构：',
    '- minimalRevision / naturalRevision: 字符串（naturalRevision 用更自然的职场英语）',
    '- shouldClarify: 布尔；clarificationQuestions: 字符串数组（仅当原意不明确需要澄清时才填，否则可省略）',
    `- issues: 对象数组，每项 {category: ${categoryList}, skillKey, originalText, correctedText, explanationZh, severity: ${severityList}}`,
    '- keyLearningPoint: {skillKey, title, explanationZh}',
    '- practice: {instructionZh, context, referenceAnswer, keywords: 字符串数组}',
  );
  return { system, user: parts.join('\n') };
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
    const { system, user } = buildPrompt(validated.data);
    const chat = await client.chat(
      config.data,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
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
