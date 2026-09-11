// T038：全局快捷键服务（shortcutService）单元测试
//
// 覆盖 docs/08 T038 验收：
// - 快捷键配置持久化到 settings 表（key=globalShortcut，JSON），缺失/损坏 → 默认值
// - 启动时按持久化配置注册；保存后重新注册（含禁用 → 解注册）
// - 注册失败（冲突）只记录 error，不抛异常
// - 按下快捷键触发注入的窗口激活回调
// - 退出时解注册全部
//
// shortcutService 是 electron-free 的（ShortcutBackend / 激活回调均注入），
// 这里用假后端 + 假仓储覆盖全部路径，不加载 electron。
import { describe, it, expect, beforeEach } from 'vitest';

import {
  applyPersistedShortcut,
  bindShortcutBackend,
  bindWindowActivator,
  resetShortcutServiceForTest,
  shortcutGet,
  shortcutSave,
  teardownShortcut,
  SHORTCUT_CONFIG_KEY,
  type ShortcutBackend,
} from '../src/main/services/shortcutService';
import { DEFAULT_GLOBAL_SHORTCUT } from '../src/shared/types/settings';
import type { SettingsRepository } from '../src/main/db/repositories/settings';

/** 记录 register/unregisterAll 调用的假后端；failRegister 模拟冲突。 */
class FakeBackend implements ShortcutBackend {
  registered: string[] = [];
  unregisterAllCount = 0;
  failRegister = false;
  lastCallback: (() => void) | null = null;

  register(accelerator: string, callback: () => void): boolean {
    if (this.failRegister) return false;
    this.registered.push(accelerator);
    this.lastCallback = callback;
    return true;
  }

  unregisterAll(): void {
    this.unregisterAllCount += 1;
    this.registered = [];
    this.lastCallback = null;
  }
}

/** 内存版 SettingsRepository（只实现 get/set，与本服务用到的接口一致）。 */
class FakeRepo {
  map = new Map<string, string>();

  get(key: string) {
    const value = this.map.get(key) ?? null;
    return value === null
      ? { ok: true as const, data: null as { key: string; value: string } | null }
      : { ok: true as const, data: { key, value } as { key: string; value: string } };
  }

  set(key: string, value: string) {
    this.map.set(key, value);
    return { ok: true as const, data: { key, value, updatedAt: '' } };
  }
}

function repoOf(fake: FakeRepo): SettingsRepository {
  return fake as unknown as SettingsRepository;
}

let backend: FakeBackend;
let repo: FakeRepo;
let activated: number;

beforeEach(() => {
  resetShortcutServiceForTest();
  backend = new FakeBackend();
  repo = new FakeRepo();
  activated = 0;
  bindShortcutBackend(backend);
  bindWindowActivator(() => {
    activated += 1;
  });
});

describe('shortcutGet', () => {
  it('无持久化配置 → 返回默认设置，未激活', () => {
    const r = shortcutGet(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings).toEqual(DEFAULT_GLOBAL_SHORTCUT);
    expect(r.data.active).toBe(false);
    expect(r.data.error).toBeNull();
  });

  it('持久化值与内存态不一致 → 重新注册后返回', () => {
    repo.map.set(
      SHORTCUT_CONFIG_KEY,
      JSON.stringify({ enabled: true, accelerator: 'CommandOrControl+Shift+U' }),
    );
    const r = shortcutGet(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings.accelerator).toBe('CommandOrControl+Shift+U');
    expect(r.data.active).toBe(true);
    expect(backend.registered).toEqual(['CommandOrControl+Shift+U']);
  });

  it('JSON 损坏 → 回退默认值（不抛错）', () => {
    repo.map.set(SHORTCUT_CONFIG_KEY, 'not-json{');
    const r = shortcutGet(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings).toEqual(DEFAULT_GLOBAL_SHORTCUT);
  });

  it('字段非法（accelerator 空串）→ 回退默认值', () => {
    repo.map.set(SHORTCUT_CONFIG_KEY, JSON.stringify({ enabled: true, accelerator: '' }));
    const r = shortcutGet(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings).toEqual(DEFAULT_GLOBAL_SHORTCUT);
  });
});

describe('applyPersistedShortcut（应用启动）', () => {
  it('默认配置（enabled）→ 注册默认快捷键', () => {
    const r = applyPersistedShortcut(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.active).toBe(true);
    expect(backend.registered).toEqual([DEFAULT_GLOBAL_SHORTCUT.accelerator]);
  });

  it('持久化为禁用 → 不解注册后注册，active=false 且无 error', () => {
    repo.map.set(SHORTCUT_CONFIG_KEY, JSON.stringify({ enabled: false, accelerator: 'a+b' }));
    const r = applyPersistedShortcut(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.active).toBe(false);
    expect(r.data.error).toBeNull();
    expect(backend.registered).toEqual([]);
    expect(backend.unregisterAllCount).toBe(1);
  });

  it('注册冲突（后端返回 false）→ active=false + 冲突提示，不抛异常', () => {
    backend.failRegister = true;
    const r = applyPersistedShortcut(repoOf(repo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.active).toBe(false);
    expect(r.data.error).toContain('冲突');
  });
});

describe('shortcutSave', () => {
  it('合法新快捷键 → 持久化 + 重新注册（先解注册旧）', () => {
    const r = shortcutSave(repoOf(repo), {
      enabled: true,
      accelerator: 'CommandOrControl+Shift+I',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings.accelerator).toBe('CommandOrControl+Shift+I');
    expect(r.data.active).toBe(true);
    expect(JSON.parse(repo.map.get(SHORTCUT_CONFIG_KEY)!)).toEqual({
      enabled: true,
      accelerator: 'CommandOrControl+Shift+I',
    });
    expect(backend.unregisterAllCount).toBe(1);
    expect(backend.registered).toEqual(['CommandOrControl+Shift+I']);
  });

  it('禁用 → 持久化 + 解注册，不注册', () => {
    const r = shortcutSave(repoOf(repo), {
      enabled: false,
      accelerator: 'CommandOrControl+Shift+Space',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.active).toBe(false);
    expect(r.data.error).toBeNull();
    expect(backend.registered).toEqual([]);
  });

  it('非法输入（accelerator 为空）→ validation，不写库不改注册', () => {
    const r = shortcutSave(repoOf(repo), { enabled: true, accelerator: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
    expect(repo.map.has(SHORTCUT_CONFIG_KEY)).toBe(false);
    expect(backend.registered).toEqual([]);
  });

  it('非法输入（非对象）→ validation', () => {
    const r = shortcutSave(repoOf(repo), 'CommandOrControl+Shift+Space');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('validation');
  });

  it('注册冲突 → 配置已持久化，但返回 active=false + 原因（不抛异常）', () => {
    backend.failRegister = true;
    const r = shortcutSave(repoOf(repo), {
      enabled: true,
      accelerator: 'CommandOrControl+Shift+U',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.active).toBe(false);
    expect(r.data.error).toContain('注册失败');
    expect(repo.map.get(SHORTCUT_CONFIG_KEY)).toBeTruthy();
  });

  it('按下快捷键 → 触发注入的窗口激活回调', () => {
    const r = shortcutSave(repoOf(repo), {
      enabled: true,
      accelerator: 'CommandOrControl+Shift+Space',
    });
    expect(r.ok).toBe(true);
    backend.lastCallback?.();
    expect(activated).toBe(1);
  });
});

describe('teardownShortcut', () => {
  it('退出时解注册全部快捷键', () => {
    applyPersistedShortcut(repoOf(repo));
    teardownShortcut();
    expect(backend.unregisterAllCount).toBe(2); // 注册前 1 次 + teardown 1 次
    expect(backend.registered).toEqual([]);
  });
});
