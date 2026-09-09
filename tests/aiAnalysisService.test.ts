// T022 — 草稿检查服务（aiAnalysisService）测试
//
// 用注入的 AiClient 替身 + FakeSecretBackend + 测试库，覆盖：
// - 校验失败 → validation（且不调用 AI）
// - 未配 AI key → config（且不调用 AI）
// - AI 超时 → timeout
// - AI 返回非法结构 → parse
// - 取消（按 requestId）→ canceled
// - 成功 → 解析并返回结果
import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeDraft,
  cancelAiAnalysis,
  __resetActiveRequestsForTest,
  type AiAnalysisDeps,
} from '../src/main/services/aiAnalysisService';
import type { AiClient, ChatMessage } from '../src/main/services/aiClient';
import { MockAiClient } from '../src/main/services/aiClient';
import type { AiRequestConfig } from '../src/main/services/aiConfigService';
import { AI_CONFIG_KEY } from '../src/main/services/aiConfigService';
import { SettingsRepository } from '../src/main/db/repositories/settings';
import type { SecretBackend } from '../src/main/services/secretBackend';
import { createTestDb } from './db/testDb';
import { ok, err } from '../src/shared/types/app';
import type { AnalyzeDraftResult } from '../src/shared/types/ai';
import type { Result } from '../src/shared/types/app';

/** 一个合法的分析结果（与 aiSchemas 的结构一致）。 */
const validResult: AnalyzeDraftResult = {
  shouldClarify: false,
  clarificationQuestions: [],
  minimalRevision: 'I will send the report later.',
  naturalRevision: 'I will send over the report shortly.',
  issues: [
    {
      category: 'tense',
      skillKey: 'tense-present',
      originalText: 'will sent',
      correctedText: 'will send',
      explanationZh: 'will 后接动词原形',
      severity: 'error',
    },
  ],
  keyLearningPoint: {
    skillKey: 'tense-present',
    title: 'will 后接动词原形',
    explanationZh: 'will 后必须接动词原形',
  },
  practice: {
    instructionZh: '用 will 造一个句子',
    context: '给经理的消息',
    referenceAnswer: 'I will send the report.',
    keywords: ['will', 'send'],
  },
};

const validInput = {
  originalEnglish: 'I will sent the report later.',
  originalChinese: '我会稍后把报告发过去',
  sourceType: 'email',
  audience: 'manager',
  tone: 'formal',
  extraInstruction: '简洁一些',
};

/** 构造 deps：测试库 + SettingsRepository + FakeSecretBackend + 可选 client。 */
function makeDeps(opts: { client?: AiClient; key?: string } = {}): AiAnalysisDeps {
  const { client, key = 'sk-test' } = opts;
  const tdb = createTestDb();
  const repo = new SettingsRepository(tdb.db);
  const value = {
    baseUrl: 'http://127.0.0.1:12346/v1',
    model: 'qwen3.8-27b',
    timeoutMs: 30000,
    saveOriginal: true,
  };
  void repo.set(AI_CONFIG_KEY, JSON.stringify(value));
  const backend: SecretBackend = {
    get: async () => key,
    set: async () => {},
    delete: async () => true,
  };
  return {
    getSettingsRepo: () => repo,
    getSecretBackend: () => backend,
    client,
  };
}

/** 记录调用次数的 client（用于断言"未调用 AI"）。 */
class CountingClient implements AiClient {
  calls = 0;
  async chat(
    _cfg: AiRequestConfig,
    _messages: readonly ChatMessage[],
    _signal?: AbortSignal,
  ): Promise<Result<string>> {
    this.calls += 1;
    return ok(JSON.stringify(validResult));
  }
}

/** 挂起直到 signal 中止的 client（模拟长 AI 调用，用于取消测试）。 */
class HangsUntilAbortClient implements AiClient {
  async chat(
    _cfg: AiRequestConfig,
    _messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ): Promise<Result<string>> {
    if (!signal) return err('unknown', 'no signal');
    if (signal.aborted) return err('canceled', 'cancelled');
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return err('canceled', 'cancelled');
  }
}

beforeEach(() => {
  __resetActiveRequestsForTest();
});

describe('analyzeDraft', () => {
  it('returns the parsed result on success', async () => {
    const deps = makeDeps({ client: new MockAiClient({ response: JSON.stringify(validResult) }) });
    const res = await analyzeDraft(validInput, 'r1', deps);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(validResult);
  });

  it('returns validation (and does not call the AI) for an empty originalEnglish', async () => {
    const counting = new CountingClient();
    const deps = makeDeps({ client: counting });
    const res = await analyzeDraft({ ...validInput, originalEnglish: '' }, 'r2', deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('validation');
    expect(counting.calls).toBe(0);
  });

  it('returns validation for an unknown sourceType', async () => {
    const counting = new CountingClient();
    const deps = makeDeps({ client: counting });
    const res = await analyzeDraft(
      { ...validInput, sourceType: 'not-a-scene' as unknown as string },
      'r3',
      deps,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('validation');
    expect(counting.calls).toBe(0);
  });

  it('returns config (and does not call the AI) when no API key is stored', async () => {
    const counting = new CountingClient();
    const deps = makeDeps({ client: counting, key: '' });
    const res = await analyzeDraft(validInput, 'r4', deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('config');
    expect(counting.calls).toBe(0);
  });

  it('returns timeout when the AI client reports a timeout', async () => {
    const deps = makeDeps({
      client: new MockAiClient({ error: { code: 'timeout', message: 'AI 请求超时' } }),
    });
    const res = await analyzeDraft(validInput, 'r5', deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('timeout');
  });

  it('returns parse when the AI returns a JSON shape that fails the Zod schema', async () => {
    const deps = makeDeps({ client: new MockAiClient({ response: '{"foo":"bar"}' }) });
    const res = await analyzeDraft(validInput, 'r6', deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('parse');
  });

  it('returns canceled when the request is canceled by requestId', async () => {
    const deps = makeDeps({ client: new HangsUntilAbortClient() });
    const p = analyzeDraft(validInput, 'r7', deps);
    setTimeout(() => {
      cancelAiAnalysis('r7');
    }, 20);
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('canceled');
  });
});

describe('cancelAiAnalysis', () => {
  it('returns false for an unknown requestId', () => {
    expect(cancelAiAnalysis('nonexistent')).toBe(false);
  });

  it('returns true for an active requestId', async () => {
    const deps = makeDeps({ client: new HangsUntilAbortClient() });
    const p = analyzeDraft(validInput, 'r8', deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelAiAnalysis('r8')).toBe(true);
    await p; // 让 in-flight 请求 settle（canceled）
  });
});
