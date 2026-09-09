// T019：AI 非密钥配置服务（aiConfigService）单元测试
//
// 覆盖 docs/08 T019：
// - 默认值：未保存 / JSON 损坏 / 字段非法时回退 DEFAULT_AI_SETTINGS（fail-safe）。
// - 校验：非法 Base URL / 超范围超时等 → validation 错误，且不写库（不污染数据）。
// - 持久化：合法输入写入 settings 表（key=aiSettings, value=JSON）并可读回（跨重启）。
// - buildAiRequestConfig（主进程内部，T020 用）：
//     * 有 Key → ok（timeoutMs = 秒 * 1000）。
//     * 无 Key → config 错误（提示去设置页）。
//     * 凭据后端故障 → 归类错误，信息不含 Key 原文。
// 全程用真实 node:sqlite settings 表 + 内存假凭据后端，不加载 keytar / Electron。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from './db/testDb';
import { SettingsRepository } from '../src/main/db/repositories/settings';
import {
  AI_CONFIG_KEY,
  loadAiConfig,
  saveAiConfig,
  buildAiRequestConfig,
} from '../src/main/services/aiConfigService';
import {
  DEFAULT_AI_SETTINGS,
  aiSettingsSchema,
  type AiSettings,
} from '../src/shared/types/settings';
import type { SecretBackend } from '../src/main/services/secretBackend';
import type { Result } from '../src/shared/types/app';

function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok === true;
}

/** 内存假凭据后端（service 已绑定），可注入故障。 */
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
    return this.map.delete(account);
  }
}

let testDb: TestDb;
let repo: SettingsRepository;
let backend: FakeSecretBackend;

beforeEach(() => {
  testDb = createTestDb();
  repo = new SettingsRepository(testDb.db);
  backend = new FakeSecretBackend();
});

afterEach(() => {
  testDb.close();
});

/** 直接向 settings 表写入原始 value（用于构造“脏数据”场景）。 */
function writeRaw(key: string, value: string): void {
  testDb.client
    .prepare(
      'INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value, new Date().toISOString());
}

describe('loadAiConfig', () => {
  it('returns defaults when nothing is saved', () => {
    expect(loadAiConfig(repo)).toEqual({ ...DEFAULT_AI_SETTINGS });
  });

  it('returns defaults when stored value is corrupt JSON', () => {
    writeRaw(AI_CONFIG_KEY, '{ this is not json');
    expect(loadAiConfig(repo)).toEqual({ ...DEFAULT_AI_SETTINGS });
  });

  it('returns defaults when stored JSON fails schema validation', () => {
    // baseUrl 非法（不是 url）
    writeRaw(AI_CONFIG_KEY, JSON.stringify({ ...DEFAULT_AI_SETTINGS, baseUrl: 'not a url' }));
    expect(loadAiConfig(repo).baseUrl).toBe(DEFAULT_AI_SETTINGS.baseUrl);
  });

  it('round-trips a saved valid config', () => {
    const cfg: AiSettings = {
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      timeoutSeconds: 90,
      saveOriginal: false,
      redactEnabled: true,
    };
    const r = saveAiConfig(repo, cfg);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.data).toEqual(cfg);

    const loaded = loadAiConfig(repo);
    expect(loaded).toEqual(cfg);
  });
});

describe('saveAiConfig', () => {
  it('accepts a valid config and stores it as JSON under the AI_CONFIG_KEY', () => {
    const cfg: AiSettings = {
      baseUrl: 'http://127.0.0.1:12346/v1',
      model: 'qwen3.8-27b',
      timeoutSeconds: 60,
      saveOriginal: true,
      redactEnabled: true,
    };
    const r = saveAiConfig(repo, cfg);
    expect(isOk(r)).toBe(true);

    const row = repo.get(AI_CONFIG_KEY);
    expect(isOk(row)).toBe(true);
    if (!isOk(row) || !row.data) return;
    const stored = JSON.parse(row.data.value) as unknown;
    expect(aiSettingsSchema.safeParse(stored).success).toBe(true);
  });

  it('rejects an invalid Base URL with a validation error and does not write', () => {
    const r = saveAiConfig(repo, { ...DEFAULT_AI_SETTINGS, baseUrl: 'not a url' });
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.code).toBe('validation');
    const got = repo.get(AI_CONFIG_KEY);
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) return;
    expect(got.data).toBeNull();
  });

  it('rejects an out-of-range timeout with a validation error', () => {
    const r = saveAiConfig(repo, { ...DEFAULT_AI_SETTINGS, timeoutSeconds: 1 });
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.code).toBe('validation');
  });

  it('rejects non-object input', () => {
    const r = saveAiConfig(repo, 'a plain string');
    expect(isOk(r)).toBe(false);
  });
});

describe('buildAiRequestConfig', () => {
  it('returns a request config with the key when it is configured', async () => {
    saveAiConfig(repo, {
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      timeoutSeconds: 30,
      saveOriginal: true,
      redactEnabled: false,
    });
    await backend.set('aiApiKey', 'sk-test-123');

    const r = await buildAiRequestConfig(repo, backend);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.data).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      timeoutMs: 30 * 1000,
      apiKey: 'sk-test-123',
    });
  });

  it('returns a config error when no key is configured', async () => {
    const r = await buildAiRequestConfig(repo, backend);
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error.code).toBe('config');
  });

  it('returns a classified error (not leaking the key) when the backend fails', async () => {
    backend.fail = true;
    backend.failWith = new Error('credential store unavailable');
    const r = await buildAiRequestConfig(repo, backend);
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    // 错误信息里绝不出现 Key 原文
    expect(JSON.stringify(r.error)).not.toContain('sk-');
  });
});
