// T018：API Key 安全存储（secretService）单元测试
//
// 覆盖 docs/02 §8.2（Windows Credential Manager / DPAPI，仅当前用户可读、不写入 SQLite）
// 与 docs/06（API Key 绝不写入日志 / 错误信息不泄露 Key）。
//
// 设计：secretService 是 electron-free 的纯函数，通过注入 SecretBackend（1 参、
// service 已绑定）解耦 keytar。这里用内存假后端（可注入故障）覆盖
// 保存 / 读取 / 清除 / 是否配置 / 输入校验 / 后端故障路径，全程不加载 keytar 原生模块。
//
// 与实现一致的关键点：
// - saveApiKey(backend, input) → Result<void>；校验失败 code='validation'；
// - readApiKey(backend) → string | null（不存在时 null，非 Result）；
// - clearApiKey(backend) → Result<void>（幂等）；
// - isApiKeyConfigured(backend) → boolean（读取失败按 false，不抛错）；
// - 后端故障经 classifyError 归类，user-facing message 固定、原始信息在 debug，均不含 Key。

import { describe, it, expect, beforeEach } from 'vitest';

import {
  saveApiKey,
  readApiKey,
  clearApiKey,
  isApiKeyConfigured,
  SECRET_SERVICE,
  AI_API_KEY_ACCOUNT,
  MAX_API_KEY_LENGTH,
} from '../src/main/services/secretService';
import type { SecretBackend } from '../src/main/services/secretBackend';

/** 内存假后端（service 已绑定，仅 account 区分），可注入故障以覆盖错误路径。 */
class FakeSecretBackend implements SecretBackend {
  private map = new Map<string, string>();
  fail = false;
  failWith: unknown = new Error('credential store unavailable');

  async get(account: string): Promise<string | null> {
    if (this.fail) throw this.failWith;
    return this.map.get(account) ?? null;
  }
  async set(account: string, secret: string): Promise<void> {
    if (this.fail) throw this.failWith;
    this.map.set(account, secret);
  }
  async delete(account: string): Promise<boolean> {
    if (this.fail) throw this.failWith;
    this.map.delete(account);
    return true;
  }
}

const KEY = 'sk-test-1234567890';

describe('secretService 常量', () => {
  it('使用固定的 service / account，Key 最长 512', () => {
    expect(SECRET_SERVICE).toBe('WorkEnglish Coach');
    expect(AI_API_KEY_ACCOUNT).toBe('aiApiKey');
    expect(MAX_API_KEY_LENGTH).toBe(512);
  });
});

describe('secretService 保存 / 读取', () => {
  let backend: FakeSecretBackend;
  beforeEach(() => {
    backend = new FakeSecretBackend();
  });

  it('保存后可读取回，isApiKeyConfigured 为 true', async () => {
    const save = await saveApiKey(backend, KEY);
    expect(save.ok).toBe(true);

    expect(await readApiKey(backend)).toBe(KEY);
    expect(await isApiKeyConfigured(backend)).toBe(true);
  });

  it('保存原始字符串（不做 trim，保留用户输入原样）', async () => {
    const padded = `  ${KEY}  `;
    const save = await saveApiKey(backend, padded);
    expect(save.ok).toBe(true);
    expect(await readApiKey(backend)).toBe(padded);
  });

  it('未保存时 readApiKey 返回 null、isApiKeyConfigured 返回 false', async () => {
    expect(await readApiKey(backend)).toBeNull();
    expect(await isApiKeyConfigured(backend)).toBe(false);
  });
});

describe('secretService 输入校验', () => {
  let backend: FakeSecretBackend;
  beforeEach(() => {
    backend = new FakeSecretBackend();
  });

  it('空字符串 → validation 错误，且不落存储', async () => {
    const r = await saveApiKey(backend, '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
    expect(await readApiKey(backend)).toBeNull();
  });

  it('纯空白字符串 → validation 错误', async () => {
    const r = await saveApiKey(backend, '    \n\t  ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
  });

  it(`超过 ${MAX_API_KEY_LENGTH} 字符 → validation 错误（message 含长度上限）`, async () => {
    const tooLong = 'a'.repeat(MAX_API_KEY_LENGTH + 1);
    const r = await saveApiKey(backend, tooLong);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
    expect(r.error.message).toContain('512');
  });

  it(`恰好 ${MAX_API_KEY_LENGTH} 字符 → 允许保存`, async () => {
    const r = await saveApiKey(backend, 'a'.repeat(MAX_API_KEY_LENGTH));
    expect(r.ok).toBe(true);
  });

  it('非字符串输入 → validation 错误', async () => {
    const r = await saveApiKey(backend, 123);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
  });
});

describe('secretService 清除', () => {
  let backend: FakeSecretBackend;
  beforeEach(() => {
    backend = new FakeSecretBackend();
  });

  it('清除后 readApiKey 返回 null、isApiKeyConfigured 返回 false', async () => {
    await saveApiKey(backend, KEY);
    const cleared = await clearApiKey(backend);
    expect(cleared.ok).toBe(true);
    expect(await readApiKey(backend)).toBeNull();
    expect(await isApiKeyConfigured(backend)).toBe(false);
  });

  it('未保存时清除是幂等的（成功，不抛错）', async () => {
    const r = await clearApiKey(backend);
    expect(r.ok).toBe(true);
    expect(await readApiKey(backend)).toBeNull();
  });
});

describe('secretService 错误路径（后端故障，经 classifyError 归类）', () => {
  let backend: FakeSecretBackend;
  beforeEach(() => {
    backend = new FakeSecretBackend();
  });

  it('set 抛错 → 保存返回分类错误，message/debug 均不含 Key', async () => {
    backend.fail = true;
    const r = await saveApiKey(backend, KEY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unknown'); // 通用 Error → classifyError → unknown
    expect(r.error.message).not.toContain(KEY);
    expect((r.error.debug ?? '')).not.toContain(KEY);
  });

  it('get 抛错 → isApiKeyConfigured 返回 false（不抛错，UI 侧安全）', async () => {
    backend.fail = true;
    expect(await isApiKeyConfigured(backend)).toBe(false);
  });

  it('delete 抛错 → 清除返回分类错误，message/debug 均不含 Key', async () => {
    await saveApiKey(backend, KEY);
    backend.fail = true;
    const r = await clearApiKey(backend);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unknown');
    expect(r.error.message).not.toContain(KEY);
    expect((r.error.debug ?? '')).not.toContain(KEY);
  });

  it('原始错误信息进入 debug（user-facing message 固定且不含 Key）', async () => {
    backend.fail = true;
    backend.failWith = new Error('DPAPI: user not logged on');
    const r = await saveApiKey(backend, KEY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).not.toContain(KEY);
    // 原始细节进 debug，供本地排查；user-facing message 保持中性
    expect(r.error.debug).toContain('DPAPI: user not logged on');
  });
});
