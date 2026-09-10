// T020 — OpenAI 兼容 AI 客户端测试（用 mock fetch 替代真实网络）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleClient, MockAiClient, type ChatMessage } from '../src/main/services/aiClient';
import type { AiRequestConfig } from '../src/main/services/aiConfigService';
import type { Result } from '../src/shared/types/app';

const CONFIG: AiRequestConfig = {
  baseUrl: 'http://127.0.0.1:12346/v1',
  model: 'qwen3.8-27b',
  timeoutMs: 5000,
  apiKey: 'sk-test',
};

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a work-English coach.' },
  { role: 'user', content: 'Please fix this draft.' },
];

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function httpErrorResponse(status: number, body: string): Response {
  return new Response(body, { status, statusText: 'err', headers: { 'Content-Type': 'text/plain' } });
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

let lastInit: RequestInit | undefined;
let lastUrl: string | undefined;

function mockFetchOnce(behavior: () => Promise<unknown>): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    lastUrl = typeof input === 'string' ? input : input.toString();
    lastInit = init;
    return behavior() as Promise<Response>;
  }) as unknown as typeof fetch;
}

// 模拟“带 AbortSignal 的 fetch”：signal 已中止 → 立即 reject(AbortError)；否则挂起直到 signal 中止（T022）。
function mockFetchRespectAbort(): typeof fetch {
  return (async (_input: string | URL, init?: RequestInit) => {
    const s = init?.signal;
    if (s && s.aborted) return Promise.reject(abortError());
    return new Promise<Response>((_resolve, reject) => {
      s?.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  }) as unknown as typeof fetch;
}

describe('OpenAICompatibleClient', () => {
  beforeEach(() => {
    lastInit = undefined;
    lastUrl = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns choices[0].message.content on 200 (with baseUrl trailing slash handled)', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() =>
        Promise.resolve(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })),
      ),
    });
    const res = await client.chat({ ...CONFIG, baseUrl: 'http://127.0.0.1:12346/v1/' }, MESSAGES);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('{"ok":true}');
    // URL 构造：去掉尾斜杠后拼 /chat/completions
    expect(lastUrl).toBe('http://127.0.0.1:12346/v1/chat/completions');
  });

  it('sends Authorization header + model + messages in body', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: 'hi' } }] }))),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(true);
    const headers = (lastInit?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(lastInit?.body)) as { model: string; messages: ChatMessage[] };
    expect(body.model).toBe('qwen3.8-27b');
    expect(body.messages).toEqual(MESSAGES);
  });

  it('routes Copilot GPT models to Responses API and extracts output text', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({
        output: [{ content: [{ type: 'output_text', text: 'pong' }] }],
      }))),
    });
    const res = await client.chat({
      ...CONFIG,
      provider: 'githubCopilot',
      baseUrl: 'https://api.githubcopilot.com',
      model: 'gpt-4o',
    }, MESSAGES);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('pong');
    expect(lastUrl).toBe('https://api.githubcopilot.com/responses');
    const body = JSON.parse(String(lastInit?.body)) as { input: ChatMessage[] };
    expect(body.input).toEqual(MESSAGES);
  });

  it('routes non-Claude Copilot models to Responses API like the reference client', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({ output_text: 'pong' }))),
    });
    const res = await client.chat({
      ...CONFIG,
      provider: 'githubCopilot',
      baseUrl: 'https://api.githubcopilot.com',
      model: 'o3-mini',
    }, MESSAGES);
    expect(res.ok).toBe(true);
    expect(lastUrl).toBe('https://api.githubcopilot.com/responses');
  });

  it('routes Copilot Claude models to Chat Completions API', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({
        choices: [{ message: { content: 'pong' } }],
      }))),
    });
    const res = await client.chat({
      ...CONFIG,
      provider: 'githubCopilot',
      baseUrl: 'https://api.githubcopilot.com',
      model: 'claude-haiku-4.5',
    }, MESSAGES);
    expect(res.ok).toBe(true);
    expect(lastUrl).toBe('https://api.githubcopilot.com/chat/completions');
  });

  it('omits Authorization header when apiKey is empty', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: 'hi' } }] }))),
    });
    const res = await client.chat({ ...CONFIG, apiKey: '' }, MESSAGES);
    expect(res.ok).toBe(true);
    const headers = (lastInit?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('maps timeout (AbortError) to code=timeout', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.reject(abortError())),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('timeout');
      expect(res.error.message).toMatch(/超时/);
    }
  });

  it('maps network failure (TypeError fetch failed) to code=network', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.reject(new TypeError('fetch failed'))),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('network');
  });

  it('maps HTTP 401 to code=config (auth / check key)', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(httpErrorResponse(401, 'invalid api key'))),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('config');
      expect(res.error.message).toMatch(/401/);
    }
  });

  it('maps HTTP 500 to code=network with status in message', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(httpErrorResponse(500, 'boom'))),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('network');
      expect(res.error.message).toMatch(/500/);
      expect(res.error.debug).toMatch(/boom/);
    }
  });

  it('maps non-JSON 200 body to code=parse', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(
        () => Promise.resolve(new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })),
      ),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });

  it('maps 200 JSON missing content to code=parse', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({ choices: [] }))),
    });
    const res = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });

  it('returns code=validation when messages is empty', async () => {
    const client = new OpenAICompatibleClient({
      fetchImpl: mockFetchOnce(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: 'x' } }] }))),
    });
    const res = await client.chat(CONFIG, []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('validation');
  });

  it('T022: maps external abort (signal) to code=canceled', async () => {
    const ac = new AbortController();
    const client = new OpenAICompatibleClient({ fetchImpl: mockFetchRespectAbort() });
    const p = client.chat(CONFIG, MESSAGES, ac.signal);
    setTimeout(() => ac.abort(), 20);
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('canceled');
  });

  it('T022: maps internal timeout (timeoutMs, no external signal) to code=timeout', async () => {
    const client = new OpenAICompatibleClient({ fetchImpl: mockFetchRespectAbort() });
    const res = await client.chat({ ...CONFIG, timeoutMs: 30 }, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('timeout');
      expect(res.error.message).toMatch(/超时/);
    }
  });

  it('T022: maps a pre-aborted signal to code=canceled', async () => {
    const ac = new AbortController();
    ac.abort();
    const client = new OpenAICompatibleClient({ fetchImpl: mockFetchRespectAbort() });
    const res = await client.chat(CONFIG, MESSAGES, ac.signal);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('canceled');
  });
});

describe('MockAiClient', () => {
  it('returns the configured response string', async () => {
    const client: import('../src/main/services/aiClient').AiClient = new MockAiClient({
      response: '{"minimal":"ok"}',
    });
    const res: Result<string> = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('{"minimal":"ok"}');
  });

  it('returns the configured AppError when set', async () => {
    const client: import('../src/main/services/aiClient').AiClient = new MockAiClient({
      error: { code: 'network', message: 'mock failure' },
    });
    const res: Result<string> = await client.chat(CONFIG, MESSAGES);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('network');
      expect(res.error.message).toBe('mock failure');
    }
  });
});
