import { create } from "zustand";

interface DecisionDraftState {
  drafts: Record<string, { targetVersion: string; value: string }>;
  setDraft: (decisionId: string, targetVersion: string, value: string) => void;
  clearDraft: (decisionId: string) => void;
  clearAll: () => void;
}

/**
 * Decision answers stay in memory while filters, polling, or routes change.
 * They are deliberately not persisted to browser storage because an answer can
 * contain private input and must disappear when the application process ends.
 */
export const useDecisionDrafts = create<DecisionDraftState>((set) => ({
  drafts: {},
  setDraft: (decisionId, targetVersion, value) =>
    set((state) => ({
      drafts: { ...state.drafts, [decisionId]: { targetVersion, value } },
    })),
  clearDraft: (decisionId) =>
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[decisionId];
      return { drafts };
    }),
  clearAll: () => set({ drafts: {} }),
}));
