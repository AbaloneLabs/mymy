import { create } from "zustand";

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

  setAuthenticated: () => void;

  setAuthState: (authenticated: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setAuthenticated: () => set({ isAuthenticated: true }),
  setAuthState: (isAuthenticated) => set({ isAuthenticated }),
}));
