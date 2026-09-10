// T042 — AI 连接测试服务（aiConnectionTestService）测试
//
// 用注入的 AiClient 替身 + FakeSecretBackend 覆盖：
// - 输入非法（空 baseUrl / 非法类型 / 超范围 timeout）→ validation（不调用 AI）
// - API Key 未配置 → config（不调用 AI）
// - 成功 → ok({latencyMs})，且传入客户端的 config 使用表单值（timeoutMs = 秒*1000）
// - 最小 Prompt 为 ping/pong（响应内容被丢弃，不出现在结果里）
// - 客户端失败（network/timeout/config/parse/canceled）→ 原样透传
import { describe, it, expect } from 'vitest';
import { testAiConnection, type AiConnectionTestDeps } from '../src/main/services/aiConnectionTestService';
import { MockAiClient, type AiClient, type ChatMessage } from '../src/main/services/aiClient';
import type { AiRequestConfig } from '../src/main/services/aiConfigService';
import type { SecretBackend } from '../src/main/services/secretBackend';
import { ok } from '../src/shared/types/app';
import type { Result } from '../src/shared/types/app';

const validInput = {
  baseUrl: 'http://127.0.0.1:12346/v1',
  model: 'qwen3.8-27b',
  timeoutSeconds: 60,
};

/** 捕获入参的客户端替身（默认成功，返回哨兵内容）。 */
class CapturingClient implements AiClient {
  calls: Array<{ config: AiRequestConfig; messages: readonly ChatMessage[] }> = [];
  async chat(config: AiRequestConfig, messages: readonly ChatMessage[]): Promise<Result<string>> {
    this.calls.push({ config, messages });
    return ok('SENTINEL_RESPONSE_CONTENT');
  }
}

function makeDeps(opts: { client?: AiClient; key?: string | null } = {}): AiConnectionTestDeps {
  const { client, key = 'sk-test' } = opts;
  const backend: SecretBackend = {
    get: async (account: string) => (account === 'aiApiKey' ? key : null),
    set: async () => {},
    delete: async () => true,
  };
  return { getSecretBackend: () => backend, client };
}

describe('T042 testAiConnection', () => {
  it('空 baseUrl → validation，且不调用 AI', async () => {
    const client = new CapturingClient();
    const r = await testAiConnection({ ...validInput, baseUrl: '' }, makeDeps({ client }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('validation');
    expect(client.calls).toHaveLength(0);
  });

  it('timeoutSeconds 超出 5–300 → validation，且不调用 AI', async () => {
    const client = new CapturingClient();
    const r = await testAiConnection({ ...validInput, timeoutSeconds: 1 }, makeDeps({ client }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('validation');
    expect(client.calls).toHaveLength(0);
  });

  it('API Key 未配置 → config（提示先保存 Key），且不调用 AI', async () => {
    const client = new CapturingClient();
    const r = await testAiConnection(validInput, makeDeps({ client, key: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('config');
      expect(r.error.message).toContain('API Key 未配置');
    }
    expect(client.calls).toHaveLength(0);
  });

  it('成功 → ok({latencyMs})，config 使用表单值（timeoutMs=秒*1000、apiKey=凭据 Key）', async () => {
    const client = new CapturingClient();
    const r = await testAiConnection(validInput, makeDeps({ client, key: 'sk-from-store' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.data.latencyMs).toBeLessThan(5000);
    }
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.config.baseUrl).toBe('http://127.0.0.1:12346/v1');
    expect(call.config.model).toBe('qwen3.8-27b');
    expect(call.config.timeoutMs).toBe(60_000);
    expect(call.config.apiKey).toBe('sk-from-store');
  });

  it('最小 Prompt 为 ping/pong，且响应内容不出现在结果里（丢弃）', async () => {
    const client = new CapturingClient();
    const r = await testAiConnection(validInput, makeDeps({ client }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const call = client.calls[0];
    expect(call.messages).toHaveLength(2);
    // system: 要求只回复 pong；user: ping
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[0].content).toMatch(/pong/i);
    expect(call.messages[1].role).toBe('user');
    expect(call.messages[1].content).toBe('ping');
    // 哨兵响应内容绝不出现在结果对象里
    expect(JSON.stringify(r.data)).not.toContain('SENTINEL');
  });

  it.each([
    ['network', '无法连接到 AI 服务'],
    ['timeout', '请求超时'],
    ['config', '401 鉴权失败'],
    ['parse', '响应结构异常'],
    ['canceled', '已取消'],
  ] as const)('客户端 %s 错误 → 原样透传', async (code, msg) => {
    const client = new MockAiClient({ error: { code, message: msg } });
    const r = await testAiConnection(validInput, makeDeps({ client }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(code);
      expect(r.error.message).toBe(msg);
    }
  });

  it('凭据存储读取抛错 → storage 错误（不崩溃、不透传堆栈）', async () => {
    const boom: SecretBackend = {
      get: async () => {
        throw new Error('DPAPI boom');
      },
      set: async () => {},
      delete: async () => true,
    };
    const client = new CapturingClient();
    const r = await testAiConnection(validInput, {
      getSecretBackend: () => boom,
      client,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('storage');
    expect(client.calls).toHaveLength(0);
  });
});
