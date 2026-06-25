import { create } from "zustand";

/**
 * Command palette open/close state.
 *
 * This is session-only state (not persisted) — the palette should never be
 * open after a refresh, and there is no reason to remember its visibility.
 */

interface CommandPaletteState {
  /** Whether the Cmd+K palette overlay is currently visible. */
  isOpen: boolean;
  /** Show the palette. */
  open: () => void;
  /** Hide the palette. */
  close: () => void;
  /** Toggle the palette visibility. */
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
