// 设置页内状态（T019：持久化改由 IPC + SQLite settings 表接管）。
//
// 重要（docs/01 §5.5、docs/08 T019）：
// - 本 store 只是「会话内的瞬时表单态」，不再用 localStorage（zustand persist）。
//   真实持久化由 SettingsPage 挂载时经 `desktopAPI.aiConfigGet()` 从 SQLite 回填、
//   保存时经 `desktopAPI.aiConfigSave()` 写回 SQLite（主进程 aiConfigService）。
// - API Key **不在本 store 内**：只保存在 OS 凭据存储（keytar/DPAPI，T018），
//   渲染进程既不持久化它、也拿不到原文，只能得知「是否已配置」。
import { create } from 'zustand';
import type { AiSettings } from '../../../../shared/types/settings';
import { DEFAULT_AI_SETTINGS } from '../../../../shared/types/settings';

export interface SettingsStore {
  ai: AiSettings;
  set: (patch: Partial<AiSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ai: { ...DEFAULT_AI_SETTINGS },
  set: (patch) => set({ ai: { ...get().ai, ...patch } }),
  reset: () => set({ ai: { ...DEFAULT_AI_SETTINGS } }),
}));
