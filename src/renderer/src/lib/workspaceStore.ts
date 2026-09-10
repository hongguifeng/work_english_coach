import { create } from 'zustand';
import type { AnalyzeDraftResult } from '../../../shared/types/ai';
import type { DraftFormSubmit, DraftFormValues } from '../pages/workspace/DraftForm';

export const INITIAL_WORKSPACE_VALUES: DraftFormValues = {
  originalChinese: '',
  originalEnglish: '',
  sourceType: 'email',
  audience: 'colleague',
  tone: 'neutral',
  saveOriginal: true,
};

interface WorkspaceState {
  draftValues: DraftFormValues;
  lastSubmit: DraftFormSubmit | null;
  result: AnalyzeDraftResult | null;
  setDraftValues: (values: Partial<DraftFormValues>) => void;
  setLastSubmit: (submit: DraftFormSubmit | null) => void;
  setResult: (result: AnalyzeDraftResult | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  draftValues: INITIAL_WORKSPACE_VALUES,
  lastSubmit: null,
  result: null,
  setDraftValues: (values) => set((state) => ({ draftValues: { ...state.draftValues, ...values } })),
  setLastSubmit: (lastSubmit) => set({ lastSubmit }),
  setResult: (result) => set({ result }),
}));