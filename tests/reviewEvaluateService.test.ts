// T031 — 复习答案 AI 评价服务（reviewEvaluateService）测试
//
// 用注入的 FakeClient + FakeSecretBackend + 测试库，覆盖（docs/08 T031 验收）：
// - 成功：AI 返回合法评价 → ok；review_attempt 落库（flags 0/1、feedbackZh JSON、improvedAnswer）
// - feedbackZh 超过 3 条 → 服务层截取前 3 条（UI/落库均 ≤3，docs/04 §7）
// - AI 返回非法结构 → parse 错误，不落库（答案可重试/暂存）
// - AI 传输失败 → 错误透传，不落库
// - API Key 缺失 → config 错误（不调 AI，不落库）
import { describe, it, expect } from 'vitest';
import {
  evaluateReviewAnswer,
  type ReviewEvaluateDeps,
} from '../src/main/services/reviewEvaluateService';
import type { AiClient, ChatMessage } from '../src/main/services/aiClient';
import { MockAiClient } from '../src/main/services/aiClient';
import type { AiRequestConfig } from '../src/main/services/aiConfigService';
import { AI_CONFIG_KEY } from '../src/main/services/aiConfigService';
import { createRepositories } from '../src/main/db/repositories';
import { SettingsRepository } from '../src/main/db/repositories/settings';
import type { SecretBackend } from '../src/main/services/secretBackend';
import { createTestDb, type TestDb } from './db/testDb';
import { ok } from '../src/shared/types/app';
import type { Result } from '../src/shared/types/app';
import type { EvaluateReviewInput } from '../src/shared/types/review';

function mustOk<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error('unexpected Result failure: ' + r.error.message);
}

const validEvaluation = {
  coreMeaningCorrect: true,
  grammarCorrect: true,
  toneAppropriate: true,
  usedTargetKnowledge: true,
  aiScore: 82,
  feedbackZh: ['反馈1', '反馈2'],
  improvedAnswer: 'I will follow up on this matter shortly.',
};

function makeDeps(tdb: TestDb, opts: { client?: AiClient; key?: string } = {}): ReviewEvaluateDeps {
  const { client, key = 'sk-test' } = opts;
  const repo = new SettingsRepository(tdb.db);
  void repo.set(AI_CONFIG_KEY, JSON.stringify({
    baseUrl: 'http://127.0.0.1:12346/v1',
    model: 'qwen3.8-27b',
    timeoutSeconds: 30,
    saveOriginal: true,
  }));
  const backend: SecretBackend = {
    get: async () => key,
    set: async () => {},
    delete: async () => true,
  };
  return { getSettingsRepo: () => repo, getSecretBackend: () => backend, client };
}

/** 返回固定内容的 client（可记录调用次数）。 */
class FixedClient implements AiClient {
  calls = 0;
  constructor(private readonly response: string) {}
  async chat(
    _c: AiRequestConfig,
    _m: readonly ChatMessage[],
    _s?: AbortSignal,
  ): Promise<Result<string>> {
    this.calls += 1;
    return ok(this.response);
  }
}

function makeInput(overrides: Partial<EvaluateReviewInput> = {}): EvaluateReviewInput & { taskId: string } {
  return {
    taskId: 'task-1',
    taskType: 'transfer',
    promptZh: '用英文给供应商写催货邮件',
    context: '订单延迟',
    keywords: ['have not received'],
    referenceAnswer: 'We have not received the goods yet.',
    userAnswer: 'We havent received the goods yet, please check.',
    usedHint: true,
    revealedAnswer: false,
    ...overrides,
  };
}

/** 插入 review_tasks 父行（review_attempts.taskId 外键要求）。 */
function insertReviewTask(tdb: TestDb, id: string): void {
  tdb.client
    .prepare(
      "INSERT INTO review_tasks (id, taskType, promptZh, referenceAnswer, scheduledAt, createdAt) VALUES (?, 'transfer', 'p', 'r', '2026-07-24T00:00:00.000Z', '2026-07-23T00:00:00.000Z')",
    )
    .run(id);
}

/** 直查 review_attempt 表（node:sqlite，避免经仓库再解析）。 */
function readAttemptRows(tdb: TestDb, taskId: string) {
  return tdb.client
    .prepare('SELECT * FROM review_attempts WHERE taskId = ?')
    .all(taskId) as Record<string, unknown>[];
}

describe('evaluateReviewAnswer', () => {
  it('succeeds and persists review_attempt (flags as 0/1, feedbackZh JSON)', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const deps = makeDeps(real, { client: new MockAiClient({ response: JSON.stringify(validEvaluation) }) });
    insertReviewTask(real, 'task-1');

    const res = await evaluateReviewAnswer(makeInput(), repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.aiScore).toBe(82);
    expect(res.data.coreMeaningCorrect).toBe(true);
    expect(res.data.usedTargetKnowledge).toBe(true);

    const rows = readAttemptRows(real, 'task-1');
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.userAnswer).toBe('We havent received the goods yet, please check.');
    expect(row.usedHint).toBe(1);
    expect(row.revealedAnswer).toBe(0);
    expect(row.aiScore).toBe(82);
    expect(row.coreMeaningCorrect).toBe(1);
    expect(row.grammarCorrect).toBe(1);
    expect(row.toneAppropriate).toBe(1);
    expect(JSON.parse(String(row.feedbackZh))).toEqual(['反馈1', '反馈2']);
    expect(row.improvedAnswer).toBe(validEvaluation.improvedAnswer);

    real.close();
  });

  it('truncates feedbackZh to at most 3 entries (docs/04 §7)', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const many = { ...validEvaluation, feedbackZh: ['a', 'b', 'c', 'd', 'e'] };
    const deps = makeDeps(real, { client: new MockAiClient({ response: JSON.stringify(many) }) });
    insertReviewTask(real, 'task-1');

    const res = await evaluateReviewAnswer(makeInput(), repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.feedbackZh).toEqual(['a', 'b', 'c']);

    const rows = readAttemptRows(real, 'task-1');
    expect(JSON.parse(String(rows[0].feedbackZh))).toEqual(['a', 'b', 'c']);

    real.close();
  });

  it('returns parse error and writes nothing when AI returns an invalid shape', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const deps = makeDeps(real, { client: new MockAiClient({ response: '{"foo":"bar"}' }) });

    const res = await evaluateReviewAnswer(makeInput(), repos, deps);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error.code).toBe('parse');
    expect(readAttemptRows(real, 'task-1').length).toBe(0);

    real.close();
  });

  it('passes through transport errors and writes nothing (UI keeps answer for retry)', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const failClient: AiClient = {
      async chat(): Promise<Result<string>> {
        return { ok: false, error: { code: 'network', message: 'boom' } };
      },
    };
    const deps = makeDeps(real, { client: failClient });

    const res = await evaluateReviewAnswer(makeInput(), repos, deps);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error.code).toBe('network');
    expect(readAttemptRows(real, 'task-1').length).toBe(0);

    real.close();
  });

  it('returns config error (no AI call, no row) when API key is missing', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const counting = new FixedClient(JSON.stringify(validEvaluation));
    const deps = makeDeps(real, { client: counting, key: '' });

    const res = await evaluateReviewAnswer(makeInput(), repos, deps);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error.code).toBe('config');
    expect(counting.calls).toBe(0);
    expect(readAttemptRows(real, 'task-1').length).toBe(0);

    real.close();
  });
});

describe('repository.getLatestAttempt', () => {
  it('returns the most recent attempt for a task (parsed feedbackZh)', async () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    insertReviewTask(real, 'task-1');
    const deps = makeDeps(real, {
      client: new MockAiClient({ response: JSON.stringify({ ...validEvaluation, aiScore: 70 }) }),
    });
    await evaluateReviewAnswer(makeInput(), repos, deps);

    const deps2 = makeDeps(real, {
      client: new MockAiClient({ response: JSON.stringify({ ...validEvaluation, aiScore: 90 }) }),
    });
    await evaluateReviewAnswer(makeInput({ userAnswer: 'second answer' }), repos, deps2);

    const latest = mustOk(repos.reviewTasks.getLatestAttempt('task-1'));
    expect(latest).not.toBeNull();
    if (latest) {
      expect(latest.aiScore).toBe(90);
      expect(latest.userAnswer).toBe('second answer');
      expect(latest.feedbackZhParsed).toEqual(['反馈1', '反馈2']);
    }
    real.close();
  });

  it('returns null when no attempts exist', () => {
    const real = createTestDb();
    const repos = createRepositories(real.db);
    const r = repos.reviewTasks.getLatestAttempt('nope');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
    real.close();
  });
});
