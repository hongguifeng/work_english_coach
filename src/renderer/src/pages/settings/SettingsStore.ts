// 设置页内状态（T011 mock 持久化 / T018 起 API Key 改由系统凭据存储接管）。
//
// 重要（docs/01 §5.5）：
// - 非密钥设置（baseUrl/model/timeout/…）persist 到 localStorage（T011 mock；
//   T019 起切换为 IPC + SQLite settings 表）。
// - API Key **不在本 store 内**：T018 起只保存在 OS 凭据存储（keytar/DPAPI），
//   渲染进程既不能持久化它，也拿不到它的原文，只能得知“是否已配置”。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiSettings } from '../../../../shared/types/settings';
import { DEFAULT_AI_SETTINGS } from '../../../../shared/types/settings';

export interface SettingsStore {
  ai: AiSettings;
  set: (patch: Partial<AiSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ai: { ...DEFAULT_AI_SETTINGS },
      set: (patch) => set({ ai: { ...get().ai, ...patch } }),
      reset: () => set({ ai: { ...DEFAULT_AI_SETTINGS } }),
    }),
    {
      name: 'wec.settings.mock',
      partialize: (state) => ({ ai: state.ai }),
    },
  ),
);
