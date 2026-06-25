import { create } from "zustand";

/**
 * Auth store — session state only.
 *
 * PIN verification is now handled server-side by the Rust backend
 * (argon2 hashing + PostgreSQL). This store only tracks the current
 * session's authenticated state (in-memory, not persisted — so a
 * refresh returns to the PIN screen).
 *
 * See: api/src/handlers/auth.rs
 */

interface AuthState {

  isAuthenticated: boolean;

  setAuthenticated: () => void;

  setAuthState: (authenticated: boolean) => void;

  lock: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setAuthenticated: () => set({ isAuthenticated: true }),
  setAuthState: (isAuthenticated) => set({ isAuthenticated }),
  lock: () => set({ isAuthenticated: false }),
}));
