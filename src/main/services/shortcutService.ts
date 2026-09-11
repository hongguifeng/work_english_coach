// T038 — 全局快捷键服务（electron-free，可在纯 Node 下测试）
//
// 职责（docs/08 T038）：
// - 把快捷键设置（enabled + accelerator）持久化到 SQLite `settings` 表
//   （key = `globalShortcut`，value = JSON）；缺失 / 损坏 / 非法时回退
//   DEFAULT_GLOBAL_SHORTCUT（fail-safe，与 AI 配置同一模式）。
// - 应用启动 / 用户保存后重新注册全局快捷键。注册后端（ShortcutBackend）
//   与“按下快捷键后的窗口激活回调”均由主进程注入（bindShortcutBackend /
//   bindWindowActivator），本文件不 import electron，保持可测。
// - 注册失败（如与系统 / 其他应用快捷键冲突）只记录 error 供设置页提示，
//   绝不抛异常、绝不影响应用其他功能。
// - 应用退出时 teardownShortcut() 解注册全部，避免残留全局快捷键。
import { err, ok } from '../../shared/types/app';
import type { Result } from '../../shared/types/app';
import {
  DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutSettingsSchema,
  type GlobalShortcutSettings,
  type GlobalShortcutState,
} from '../../shared/types/settings';
import type { SettingsRepository } from '../db/repositories/settings';

/** `settings` 表中存放全局快捷键配置的键。 */
export const SHORTCUT_CONFIG_KEY = 'globalShortcut';

/** 全局快捷键注册后端（主进程注入 electron.globalShortcut 的绑定实现）。 */
export interface ShortcutBackend {
  /** 注册快捷键；冲突（已被占用）或格式无效时返回 false，不抛异常。 */
  register(accelerator: string, callback: () => void): boolean;
  /** 解注册全部快捷键。 */
  unregisterAll(): void;
  /** 可选：最近一次注册失败的具体原因（如 accelerator 格式无效）；无则返回 null。 */
  describeLastError?(): string | null;
}

/** 当前内存态：最近一次 get/save/apply 后的设置与注册结果。 */
let state: GlobalShortcutState = {
  settings: { ...DEFAULT_GLOBAL_SHORTCUT },
  active: false,
  error: null,
};

let boundBackend: ShortcutBackend | null = null;
let boundActivator: (() => void) | null = null;

/** 主进程启动时调用：绑定 electron.globalShortcut 后端。 */
export function bindShortcutBackend(backend: ShortcutBackend): void {
  boundBackend = backend;
}

/** 主进程启动时调用：绑定“按下快捷键”时的窗口激活回调（show/restore/focus）。 */
export function bindWindowActivator(activator: () => void): void {
  boundActivator = activator;
}

/** 测试用：重置模块级状态。 */
export function resetShortcutServiceForTest(): void {
  state = { settings: { ...DEFAULT_GLOBAL_SHORTCUT }, active: false, error: null };
  boundBackend = null;
  boundActivator = null;
}

/**
 * 读取已持久化快捷键设置；缺失 / JSON 损坏 / 字段非法时回退默认值（不抛错）。
 */
function readPersisted(repo: SettingsRepository): GlobalShortcutSettings {
  const res = repo.get(SHORTCUT_CONFIG_KEY);
  if (!res.ok) return { ...DEFAULT_GLOBAL_SHORTCUT };
  const row = res.data;
  if (!row || row.value.length === 0) return { ...DEFAULT_GLOBAL_SHORTCUT };
  try {
    const parsed = JSON.parse(row.value) as unknown;
    const check = globalShortcutSettingsSchema.safeParse(parsed);
    if (check.success) return check.data;
  } catch {
    // 损坏 → 默认
  }
  return { ...DEFAULT_GLOBAL_SHORTCUT };
}

/** 按给定设置重新注册（先解注册旧的全部快捷键），并更新内存态。 */
function apply(settings: GlobalShortcutSettings): void {
  if (!boundBackend) {
    state = { settings: { ...settings }, active: false, error: null };
    return;
  }
  boundBackend.unregisterAll();
  if (!settings.enabled) {
    state = { settings: { ...settings }, active: false, error: null };
    return;
  }
  const registered = boundBackend.register(settings.accelerator, () => {
    boundActivator?.();
  });
  if (registered) {
    state = { settings: { ...settings }, active: true, error: null };
    return;
  }
  const reason =
    boundBackend.describeLastError?.() ??
    '可能与系统或其他应用的快捷键冲突，或格式无效，请在设置中更换';
  state = {
    settings: { ...settings },
    active: false,
    error: `快捷键「${settings.accelerator}」注册失败：${reason}`,
  };
}

/**
 * 读取快捷键设置 + 当前注册状态（设置页挂载时用）。
 * 若持久化值与内存态不一致（如外部改了库），先重新注册再返回。
 */
export function shortcutGet(repo: SettingsRepository): Result<GlobalShortcutState> {
  const settings = readPersisted(repo);
  if (
    state.settings.enabled !== settings.enabled ||
    state.settings.accelerator !== settings.accelerator
  ) {
    apply(settings);
  }
  return ok({ settings: { ...state.settings }, active: state.active, error: state.error });
}

/**
 * 校验并持久化快捷键设置，然后重新注册：
 * - 非法输入（空 accelerator 等）→ validation 错误，不写库、不改注册；
 * - 合法 → 写库 + 重新注册（enabled=false 或注册失败 → active=false 并给出原因）。
 */
export function shortcutSave(
  repo: SettingsRepository,
  input: unknown,
): Result<GlobalShortcutState> {
  const parsed = globalShortcutSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err('validation', issue ? issue.message : '快捷键设置不合法');
  }
  const res = repo.set(SHORTCUT_CONFIG_KEY, JSON.stringify(parsed.data));
  if (!res.ok) return res; // ErrResult（存储错误）
  apply(parsed.data);
  return ok({ settings: { ...state.settings }, active: state.active, error: state.error });
}

/**
 * 应用启动时调用：按已持久化的设置注册全局快捷键（不写库）。
 * 注册失败只记录状态，不抛异常。
 */
export function applyPersistedShortcut(repo: SettingsRepository): Result<GlobalShortcutState> {
  apply(readPersisted(repo));
  return ok({ settings: { ...state.settings }, active: state.active, error: state.error });
}

/** 应用退出时调用：解注册全部全局快捷键，避免残留。 */
export function teardownShortcut(): void {
  boundBackend?.unregisterAll();
  state = { settings: { ...DEFAULT_GLOBAL_SHORTCUT }, active: false, error: null };
}
