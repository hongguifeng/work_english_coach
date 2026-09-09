// T010（mock）：表达库页面内状态。T026 起数据源替换为 IPC + SQLite（仓库 + Service），页面组件保持不变。
import { create } from 'zustand';
import type {
  AddExpressionInput,
  ExpressionRecord,
  UpdateExpressionInput,
} from '../../../../shared/types/library';
import { createMockLibrary } from './mockLibrary';

interface ExpressionStore {
  items: ExpressionRecord[];
  nextId: number;
  add: (input: AddExpressionInput) => ExpressionRecord;
  update: (id: number, patch: UpdateExpressionInput) => void;
  archive: (id: number) => void;
  restore: (id: number) => void;
  /** 清空本地列表（T017：删除全部数据后由 data:changed 触发；T026 起改为从 DB 重新拉取）。 */
  reset: () => void;
}

export const useExpressionStore = create<ExpressionStore>()((set, get) => ({
  items: createMockLibrary(),
  nextId: 100,

  add: (input) => {
    const { items, nextId } = get();
    const record: ExpressionRecord = {
      id: nextId,
      ...input,
      status: 'active',
      createdAt: new Date().toISOString().slice(0, 10),
      lastPracticedAt: null,
      timesPracticed: 0,
    };
    set({ items: [record, ...items], nextId: nextId + 1 });
    return record;
  },

  update: (id, patch) => {
    set({
      items: get().items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  },

  archive: (id) => {
    set({
      items: get().items.map((item) =>
        item.id === id ? { ...item, status: 'archived' } : item,
      ),
    });
  },

  restore: (id) => {
    set({
      items: get().items.map((item) =>
        item.id === id ? { ...item, status: 'active' } : item,
      ),
    });
  },

  reset: () => {
    set({ items: [], nextId: 100 });
  },
}));
