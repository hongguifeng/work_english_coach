// T028 — 复习任务生成服务（reviewTaskService）测试
//
// 用注入的 MockAiClient + FakeSecretBackend + 测试库，覆盖（docs/08 T028 验收）：
// - 成功：skill（按 skillKey）/ expression（按 id）→ 写入 review_tasks，
//   scheduledAt = +1 天，taskType 默认 transfer/rewrite
// - 去重 ①：源对象已有 pending 任务 → 返回现有（created=false，不调 AI）
// - 去重 ②：AI 产出的 promptZh 与已有任务完全相同 → 返回现有（created=false）
// - AI 非法结构 → parse 错误（不写库）
// - 源不存在 → validation（不调 AI）
// - rowToTaskView：keywords JSON 解析（非法 → []，不抛异常）
import { describe, it, expect } from 'vitest';
import {
  generateReviewTask,
  rowToTaskView,
  type ReviewTaskDeps,
} from '../src/main/services/reviewTaskService';
import type { AiClient, ChatMessage } from '../src/main/services/aiClient';
import { MockAiClient } from '../src/main/services/aiClient';
import type { AiRequestConfig } from '../src/main/services/aiConfigService';
import { AI_CONFIG_KEY } from '../src/main/services/aiConfigService';
import { createRepositories } from '../src/main/db/repositories';
import type { ReviewTaskRow } from '../src/main/db/schema';
import { SettingsRepository } from '../src/main/db/repositories/settings';
import type { SecretBackend } from '../src/main/services/secretBackend';
import { createTestDb, type TestDb } from './db/testDb';
import { ok } from '../src/shared/types/app';
import type { Result } from '../src/shared/types/app';

/** 把 Result 收窄为非空 data（测试断言用；失败时抛错让用例显式失败）。 */
function mustOk<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new Error('unexpected Result failure: ' + r.error.message);
}

/** 合法的复习题（与 reviewGenerationSchema 一致：taskType/promptZh/context/keywords/referenceAnswer 均必填）。 */
const validGen = {
  taskType: 'transfer',
  promptZh: '用英文给供应商写一封催货邮件，使用现在完成时。',
  context: '订单延迟',
  keywords: ['have not received', 'still waiting'],
  referenceAnswer: 'We have not received the goods yet, so please confirm the shipping status.',
};

/** 构造 deps：测试库 + 设置（timeoutSeconds）+ 凭据 + 可选 client。 */
function makeDeps(
  tdb: TestDb,
  opts: { client?: AiClient; key?: string } = {},
): ReviewTaskDeps {
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

/** 记录调用次数的 client（用于断言"未调用 AI"）。 */
class CountingClient implements AiClient {
  calls = 0;
  async chat(
    _c: AiRequestConfig,
    _m: readonly ChatMessage[],
    _s?: AbortSignal,
  ): Promise<Result<string>> {
    this.calls += 1;
    return ok(JSON.stringify(validGen));
  }
}

function setup(opts: { client?: AiClient; key?: string } = {}) {
  const tdb = createTestDb();
  const repos = createRepositories(tdb.db);
  const deps = makeDeps(tdb, opts);
  return { tdb, repos, deps };
}

describe('generateReviewTask', () => {
  it('creates a task from a skill (by skillKey); default taskType=transfer, scheduledAt=+1d', async () => {
    const { tdb, repos, deps } = setup({
      client: new MockAiClient({ response: JSON.stringify(validGen) }),
    });
    const skill = mustOk(
      repos.skills.upsert({
        skillKey: 'tense_present_perfect',
        title: '现在完成时',
        category: 'tense',
        explanationZh: 'have done 表示已完成',
      }),
    );

    const res = await generateReviewTask({ source: 'skill', id: 'tense_present_perfect' }, repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.created).toBe(true);
    expect(res.data.task.taskType).toBe('transfer');
    expect(res.data.task.skillId).toBe(skill.id);
    expect(res.data.task.promptZh).toBe(validGen.promptZh);
    expect(res.data.task.status).toBe('pending');
    const dayMs = 24 * 60 * 60 * 1000;
    const delta = new Date(res.data.task.scheduledAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan(dayMs * 0.9);
    expect(delta).toBeLessThan(dayMs * 1.1);

    tdb.close();
  });

  it('dedupes when a pending task already exists for the skill (no AI call)', async () => {
    const counting = new CountingClient();
    const { tdb, repos, deps } = setup({ client: counting });
    const skill = mustOk(
      repos.skills.upsert({
        skillKey: 'tense_present_perfect',
        title: '现在完成时',
        category: 'tense',
        explanationZh: 'have done 表示已完成',
      }),
    );
    // 预先创建一个 pending 任务
    const task = mustOk(
      repos.reviewTasks.create({
        taskType: 'transfer',
        skillId: skill.id,
        promptZh: 'existing prompt',
        referenceAnswer: 'existing answer',
        scheduledAt: new Date().toISOString(),
      }),
    );

    const res = await generateReviewTask({ source: 'skill', id: skill.id }, repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.created).toBe(false);
    expect(res.data.task.id).toBe(task.id);
    expect(res.data.task.promptZh).toBe('existing prompt');
    expect(counting.calls).toBe(0); // 去重命中，未调用 AI

    tdb.close();
  });

  it('creates a task from an expression (by id); default taskType=rewrite', async () => {
    const { tdb, repos, deps } = setup({
      client: new MockAiClient({ response: JSON.stringify(validGen) }),
    });
    const expr = mustOk(
      repos.expressions.create({
        title: 'Could you please',
        chineseMeaning: '礼貌请求',
        example: 'Could you please send me the file?',
      }),
    );

    const res = await generateReviewTask({ source: 'expression', id: expr.id }, repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.created).toBe(true);
    expect(res.data.task.expressionId).toBe(expr.id);
    expect(res.data.task.taskType).toBe('rewrite'); // expression 默认 rewrite

    tdb.close();
  });

  it('dedupes when the AI output promptZh equals an existing (non-pending) task', async () => {
    const { tdb, repos } = setup();
    const skill = mustOk(
      repos.skills.upsert({
        skillKey: 'preposition_on',
        title: '介词 on',
        category: 'preposition',
        explanationZh: 'on 表示在…上面',
      }),
    );
    // 预创建一条与 AI 输出 promptZh 完全相同的任务，并标记为 completed
    // （completed → pending 去重不命中，走到 promptZh 去重分支）
    const existing = mustOk(
      repos.reviewTasks.create({
        taskType: 'transfer',
        skillId: skill.id,
        promptZh: validGen.promptZh,
        referenceAnswer: validGen.referenceAnswer,
        scheduledAt: new Date().toISOString(),
      }),
    );
    void repos.reviewTasks.complete(existing.id);
    const deps = makeDeps(tdb, {
      client: new MockAiClient({ response: JSON.stringify(validGen) }),
    });

    const res = await generateReviewTask({ source: 'skill', id: 'preposition_on' }, repos, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('fail');
    expect(res.data.created).toBe(false);
    expect(res.data.task.id).toBe(existing.id);
    expect(res.data.task.promptZh).toBe(validGen.promptZh);

    tdb.close();
  });

  it('returns parse (and writes nothing) when the AI returns an invalid shape', async () => {
    const { tdb, repos, deps } = setup({ client: new MockAiClient({ response: '{"foo":"bar"}' }) });
    const skill = mustOk(
      repos.skills.upsert({
        skillKey: 'article_a',
        title: '冠词 a',
        category: 'article',
        explanationZh: 'a/an 用法',
      }),
    );

    const res = await generateReviewTask({ source: 'skill', id: 'article_a' }, repos, deps);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected fail');
    expect(res.error.code).toBe('parse');
    // 未写库
    const tasks = mustOk(repos.reviewTasks.getBySkill(skill.id));
    expect(tasks.length).toBe(0);

    tdb.close();
  });

  it('returns validation (no AI call) when the source does not exist', async () => {
    const counting = new CountingClient();
    const { tdb, repos, deps } = setup({ client: counting });

    const r1 = await generateReviewTask({ source: 'skill', id: 'does_not_exist' }, repos, deps);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('validation');

    const r2 = await generateReviewTask({ source: 'expression', id: 'no_such_expr' }, repos, deps);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('validation');
    expect(counting.calls).toBe(0); // 两种源都不存在 → 均未调用 AI

    tdb.close();
  });
});

describe('rowToTaskView', () => {
  it('parses the keywords JSON field into an array', () => {
    const view = rowToTaskView({
      id: 't1',
      taskType: 'transfer',
      skillId: null,
      expressionId: null,
      promptZh: 'p',
      context: 'c',
      keywords: JSON.stringify(['a', 'b']),
      referenceAnswer: 'r',
      acceptableAnswers: null,
      status: 'pending',
      scheduledAt: '2025-01-01T00:00:00Z',
      completedAt: null,
      createdAt: '2025-01-01T00:00:00Z',
    });
    expect(view.keywords).toEqual(['a', 'b']);
    expect(view.status).toBe('pending');
    expect(view.id).toBe('t1');
  });

  it('returns empty keywords for null or invalid JSON (no throw)', () => {
    const base: ReviewTaskRow = {
      id: 't2',
      taskType: 'rewrite',
      skillId: null,
      expressionId: null,
      promptZh: 'p',
      context: null,
      keywords: null,
      referenceAnswer: 'r',
      acceptableAnswers: null,
      status: 'pending',
      scheduledAt: '2025-01-01T00:00:00Z',
      completedAt: null,
      createdAt: '2025-01-01T00:00:00Z',
    };
    expect(rowToTaskView({ ...base, keywords: null }).keywords).toEqual([]);
    expect(rowToTaskView({ ...base, keywords: 'not-json' }).keywords).toEqual([]);
    expect(rowToTaskView({ ...base, keywords: '[1,2]' }).keywords).toEqual([]);
  });
});
