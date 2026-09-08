// T011（mock 持久化）：设置页内状态。
// 非密钥设置 persist 到 localStorage；API Key 仅保存在内存，绝不持久化
// （T018 起由 DPAPI 系统凭据存储接管，T016 起整体切换为 IPC + SQLite settings 表）。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiSettings } from '../../../../shared/types/settings';
import { DEFAULT_AI_SETTINGS } from '../../../../shared/types/settings';

export interface SettingsStore {
  ai: AiSettings;
  /** 仅内存；T018 起由主进程 DPAPI 存取，UI 只通过 IPC 读取“是否已设置” */
  apiKey: string;
  set: (patch: Partial<AiSettings>) => void;
  setApiKey: (key: string) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ai: { ...DEFAULT_AI_SETTINGS },
      apiKey: '',
      set: (patch) => set({ ai: { ...get().ai, ...patch } }),
      setApiKey: (key) => set({ apiKey: key }),
      reset: () => set({ ai: { ...DEFAULT_AI_SETTINGS }, apiKey: '' }),
    }),
    {
      name: 'wec.settings.mock',
      partialize: (state) => ({ ai: state.ai }),
    },
  ),
);
