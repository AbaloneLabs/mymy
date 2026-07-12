import { create } from "zustand";
import { useDecisionDrafts } from "@/store/decisionDrafts";
import { clearDocumentEditorRecoveryDrafts } from "@/features/documentEditor/shell/documentEditorRecoveryDraft";

/**
 * Auth store — session state only.
 *
 * PIN verification is now handled server-side by the Rust backend
 * (argon2 hashing + PostgreSQL). This store only tracks the current
 * session's authenticated state (in-memory, not persisted). The server's
 * `/auth/status` endpoint remains the source of truth for route access.
 *
 * See: api/src/handlers/auth.rs
 */

interface AuthState {
  isAuthenticated: boolean;
  recoveryScopeId: string | null;
  setAuthenticated: (recoveryScopeId: string) => void;
  setAuthState: (authenticated: boolean, recoveryScopeId?: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  recoveryScopeId: null,
  setAuthenticated: (recoveryScopeId) =>
    set({ isAuthenticated: true, recoveryScopeId }),
  setAuthState: (isAuthenticated, recoveryScopeId = null) => {
    if (!isAuthenticated) {
      useDecisionDrafts.getState().clearAll();
      void clearDocumentEditorRecoveryDrafts().catch(() => undefined);
    }
    set({
      isAuthenticated,
      recoveryScopeId: isAuthenticated ? recoveryScopeId : null,
    });
  },
}));
