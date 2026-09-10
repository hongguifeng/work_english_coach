// T020 — OpenAI 兼容 AI 客户端（electron-free，可在纯 Node 下用 mock 测试）
//
// 职责（docs/08 T020、docs/04 AI 契约）：
// - 调用 OpenAI 兼容的 `POST {baseUrl}/chat/completions`，返回 `choices[0].message.content`（原始字符串）。
// - 支持 Base URL / 模型名 / API Key（Bearer）/ 超时（AbortController）。
// - 统一失败语义：所有失败都映射为共享 `Result<string>` 的 error 侧（AppError）：
//     * 网络不可达 / 连接失败      -> code: 'network'
//     * 超时（abort）              -> code: 'timeout'
//     * HTTP 401/403（鉴权失败）    -> code: 'config'（提示检查 API Key）
//     * 其它非 2xx（4xx/5xx）      -> code: 'network'（带状态码）
//     * 响应非 JSON / 缺 content    -> code: 'parse'
// - 不在此处解析/校验业务结构（AiAnalysisResult 的 Zod 校验属 T021）；本层只负责
//   “把 prompt 发出去、把 content 字符串拿回来、失败时给出统一 AppError”。
// - 提供 MockAiClient 以便单测与 UI 测试替代真实 AI（验收：可用 mock 测试替代真实 AI）。
//
// 安全：API Key 只出现在请求头里，绝不写入日志或返回体；错误 debug 信息截断，避免泄漏。
import { err, ok } from '../../shared/types/app';
import type { Result, ErrorCode, AppError } from '../../shared/types/app';
import type { AiRequestConfig } from './aiConfigService';

/** OpenAI chat/completions 消息。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * AI 客户端接口。
 * `chat` 返回 `Result<string>`：成功为 `choices[0].message.content`（原始字符串，
 * 后续由 T021 的 Zod Schema 解析成结构化结果）；失败为统一 AppError。
 */
export interface AiClient {
  /**
   * 发送一次 chat completion 请求。
   * @param signal 可选的外部中止信号（例如用户取消）。
   *   - 未传：内部超时 → `timeout`。
   *   - 传入且在超时前 abort → `canceled`（区分于超时，便于 UI 静默处理）。
   *   - 传入且在超时后 abort → 仍是 `timeout`（以先发生者为准）。
   */
  chat(
    config: AiRequestConfig,
    messages: readonly ChatMessage[],
    signal?: AbortSignal
  ): Promise<Result<string>>;
}

/** 可注入的 fetch 实现（默认 globalThis.fetch），便于测试替身。 */
export type FetchImpl = typeof fetch;

interface OpenAICompatibleClientOptions {
  fetchImpl?: FetchImpl;
}

function modelEndpoint(config: AiRequestConfig): 'chat/completions' | 'responses' {
  // API Key 模式：尊重用户在设置页选择的接口（缺省 chatCompletions）
  if (config.provider !== 'githubCopilot') {
    return config.apiEndpoint === 'responses' ? 'responses' : 'chat/completions';
  }
  // GitHub Copilot 模式：按模型自动选择（与参考客户端一致，用户设置不生效）
  return config.model.toLowerCase().startsWith('claude')
    ? 'chat/completions'
    : 'responses';
}

function buildUrl(baseUrl: string, endpoint: 'chat/completions' | 'responses'): string {
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint}`;
}

function buildRequestBody(
  config: AiRequestConfig,
  messages: readonly ChatMessage[],
  endpoint: 'chat/completions' | 'responses',
): string {
  if (endpoint === 'responses') {
    // Copilot 参考客户端要求 SSE 流式；其它 OpenAI 兼容服务走非流式 JSON
    return JSON.stringify({
      model: config.model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(config.provider === 'githubCopilot'
        ? {
            reasoning: { effort: config.reasoningEffort ?? 'none' },
            stream: true,
          }
        : {}),
    });
  }
  return JSON.stringify({
    model: config.model,
    messages: [...messages],
    ...(config.provider === 'githubCopilot'
      ? {
          reasoning_effort: config.reasoningEffort ?? 'none',
          stream: true,
          stream_options: { include_usage: true },
        }
      : {}),
  });
}

/** 截断过长的响应体，避免把大段/敏感内容写进 debug 日志。 */
function truncate(s: string, max = 300): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 判断是否为 abort（超时）导致的错误。 */
function isAbortError(e: unknown): boolean {
  if (e == null) return false;
  const name = (e as { name?: unknown }).name;
  return name === 'AbortError';
}

export class OpenAICompatibleClient implements AiClient {
  private readonly fetchImpl: FetchImpl;

  constructor(opts: OpenAICompatibleClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async chat(
    config: AiRequestConfig,
    messages: readonly ChatMessage[],
    signal?: AbortSignal
  ): Promise<Result<string>> {
    // 入参基础校验：model / baseUrl 非空、messages 非空
    if (!config.baseUrl || !config.model || messages.length === 0) {
      return err('validation', 'AI 请求参数不完整（baseUrl / model / messages）');
    }

    const controller = new AbortController();
    // 记录“是谁先触发了中止”：内部超时 或 外部取消，以先发生者为准。
    // （不用 AbortSignal.any，便于区分 timeout 与 canceled。）
    let abortedBy: 'timeout' | 'canceled' | null = null;
    const onTimeout = (): void => {
      abortedBy = abortedBy ?? 'timeout';
      controller.abort();
    };
    const timer = setTimeout(onTimeout, config.timeoutMs);
    const onExternalAbort = (): void => {
      abortedBy = abortedBy ?? 'canceled';
      controller.abort();
    };
    if (signal) {
      if (signal.aborted) {
        onExternalAbort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    try {
      const endpoint = modelEndpoint(config);
      const res = await this.fetchImpl(buildUrl(config.baseUrl, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // API Key 只进请求头；无 Key 时不发 Authorization（部分本地服务不需要）
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          ...(config.provider === 'githubCopilot'
            ? {
                'Copilot-Integration-Id': 'vscode-chat',
                'Editor-Version': 'vscode/1.91.0',
                Accept: 'application/json',
              }
            : {}),
        },
        body: buildRequestBody(config, messages, endpoint),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const detail = truncate(body);
        // 401/403 是鉴权问题 -> config（提示检查 Key）；其它 -> network
        const code: ErrorCode = res.status === 401 || res.status === 403 ? 'config' : 'network';
        const message =
          code === 'config'
            ? `AI 鉴权失败（HTTP ${res.status}），请检查 API Key 是否有效`
            : `AI 请求失败（HTTP ${res.status}）`;
        return err(
          code,
          detail ? `${message}：${detail}` : message,
          detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
        );
      }

      let content: string | null;
      try {
        content = config.provider === 'githubCopilot'
          ? await extractCopilotResponse(res, endpoint)
          : extractStandardResponse(await res.json(), endpoint);
      } catch {
        return err('parse', 'AI 响应不是有效 JSON 或 SSE');
      }
      if (content === null) {
        return err('parse', endpoint === 'responses'
          ? 'AI 响应缺少文本内容（responses.output）'
          : 'AI 响应缺少消息内容（choices[0].message.content）');
      }
      return ok(content);
    } catch (e) {
      if (abortedBy === 'canceled') {
        return err('canceled', 'AI 请求已取消');
      }
      if (abortedBy === 'timeout' || isAbortError(e)) {
        return err('timeout', `AI 请求超时（${config.timeoutMs}ms），请稍后重试或调大超时`);
      }
      // fetch 网络错误（undici 抛 TypeError: fetch failed / 连接失败等）
      const raw = e instanceof Error ? e.message : String(e);
      return err('network', 'AI 网络请求失败，请检查网络或 Base URL', raw);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function extractStandardResponse(
  data: unknown,
  endpoint: 'chat/completions' | 'responses',
): string | null {
  return endpoint === 'responses' ? extractResponsesContent(data) : extractContent(data);
}

/** Copilot 参考客户端使用 SSE；这里聚合文本后交给现有非流式业务层。 */
async function extractCopilotResponse(
  response: Response,
  endpoint: 'chat/completions' | 'responses',
): Promise<string | null> {
  const raw = await response.text();
  try {
    return extractStandardResponse(JSON.parse(raw) as unknown, endpoint);
  } catch {
    // SSE events are separated by a blank line and carry JSON after `data:`.
  }

  let answer = '';
  for (const event of raw.split(/\r?\n\r?\n/)) {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;
      const data = JSON.parse(payload) as unknown;
      const text = endpoint === 'responses'
        ? extractResponsesStreamText(data)
        : extractChatStreamText(data);
      answer += text;
    }
  }
  return answer || null;
}

function extractResponsesStreamText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const event = data as { type?: unknown; delta?: unknown };
  return event.type === 'response.output_text.delta' && typeof event.delta === 'string'
    ? event.delta
    : '';
}

function extractChatStreamText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';
  return choices.map((choice) => {
    if (typeof choice !== 'object' || choice === null) return '';
    const delta = (choice as { delta?: unknown }).delta;
    if (typeof delta !== 'object' || delta === null) return '';
    const content = (delta as { content?: unknown }).content;
    return typeof content === 'string' ? content : '';
  }).join('');
}

/** 从 chat/completions 响应体中提取 content；结构不符返回 null（交给上层判 parse 错）。 */
function extractContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | null;
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** 从 OpenAI Responses API 响应中提取 output_text。 */
function extractResponsesContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const direct = (data as { output_text?: unknown }).output_text;
  if (typeof direct === 'string') return direct;
  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const text = output.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (typeof part !== 'object' || part === null) return [];
      const value = (part as { text?: unknown }).text;
      return typeof value === 'string' ? [value] : [];
    });
  }).join('');
  return text || null;
}

/**
 * Mock AI 客户端：用于单测与 UI 测试替代真实 AI。
 * - 默认返回预设 `response` 字符串。
 * - 可配置 `error`（AppError）以模拟失败路径（返回对应 err）。
 */
export class MockAiClient implements AiClient {
  constructor(
    private readonly opts: {
      response?: string;
      error?: AppError;
    } = {},
  ) {}

  async chat(): Promise<Result<string>> {
    if (this.opts.error) return err(this.opts.error.code, this.opts.error.message, this.opts.error.debug);
    return ok(this.opts.response ?? '');
  }
}
