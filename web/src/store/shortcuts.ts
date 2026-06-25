import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Keyboard shortcut override store.
 *
 * Phase 1 (this file): localStorage persistence via Zustand persist.
 * Phase 2 (future): backend DB sync via `app_settings.keyboard_shortcuts`.
 *                   Only `TODO(backend)` markers are left for now.
 *
 * The store keeps a map of actionId → keys[]. When an action has no entry in
 * `overrides`, the value from DEFAULT_BINDINGS is used.
 */

/** Action category — mirrors the command registry categories. */
export type ShortcutCategory = "navigation" | "actions" | "global";

export interface ShortcutDefinition {
  /** Unique action id (matches a command id, e.g. "navigate.home"). */
  actionId: string;
  /** Default key tokens (e.g. ["mod", "k"], ["g", "h"]). */
  defaultKeys: string[];
  /** Display category for the shortcuts page. */
  category: ShortcutCategory;
}

/**
 * Default shortcut bindings.
 *
 * Navigation uses Linear-style 2-key sequences (G then X).
 * Note: Calendar uses `L` (caLendar) to avoid colliding with Chat (`C`).
 */
export const DEFAULT_BINDINGS: ShortcutDefinition[] = [
  // Navigation (2-key sequences)
  { actionId: "navigate.home", defaultKeys: ["g", "h"], category: "navigation" },
  { actionId: "navigate.chat", defaultKeys: ["g", "c"], category: "navigation" },
  { actionId: "navigate.calendar", defaultKeys: ["g", "l"], category: "navigation" },
  { actionId: "navigate.notes", defaultKeys: ["g", "n"], category: "navigation" },
  { actionId: "navigate.tasks", defaultKeys: ["g", "t"], category: "navigation" },
  { actionId: "navigate.knowledge", defaultKeys: ["g", "k"], category: "navigation" },
  { actionId: "navigate.agents", defaultKeys: ["g", "a"], category: "navigation" },
  { actionId: "navigate.finance", defaultKeys: ["g", "f"], category: "navigation" },
  { actionId: "navigate.goals", defaultKeys: ["g", "o"], category: "navigation" },
  { actionId: "navigate.settings", defaultKeys: ["g", "s"], category: "navigation" },
  { actionId: "navigate.shortcuts", defaultKeys: ["g", "u"], category: "navigation" },

  // Global actions (modifier based)
  { actionId: "palette.toggle", defaultKeys: ["mod", "k"], category: "global" },
  { actionId: "action.lock", defaultKeys: ["mod", "shift", "l"], category: "global" },

  // Context actions (single key, active per-route)
  { actionId: "create.task", defaultKeys: ["t"], category: "actions" },
  { actionId: "create.note", defaultKeys: ["n"], category: "actions" },
  { actionId: "create.event", defaultKeys: ["e"], category: "actions" },
  { actionId: "create.chat", defaultKeys: ["c"], category: "actions" },
];

/** Lookup table for the default keys of a given action id. */
const DEFAULT_KEYS_MAP: Record<string, string[]> = Object.fromEntries(
  DEFAULT_BINDINGS.map((b) => [b.actionId, b.defaultKeys])
);

interface ShortcutState {
  /** User overrides. Empty object = all defaults. */
  overrides: Record<string, string[]>;
  /** Set a custom binding for an action. */
  setShortcut: (actionId: string, keys: string[]) => void;
  /** Reset a single action to its default binding. */
  resetShortcut: (actionId: string) => void;
  /** Reset every action to its default binding. */
  resetAll: () => void;
  /** Resolve the active keys for an action (override > default). */
  getBinding: (actionId: string) => string[];
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      overrides: {},

      setShortcut: (actionId, keys) =>
        set((state) => ({
          overrides: { ...state.overrides, [actionId]: keys },
        })),

      resetShortcut: (actionId) =>
        set((state) => {
          const next = { ...state.overrides };
          delete next[actionId];
          return { overrides: next };
        }),

      resetAll: () => set({ overrides: {} }),

      getBinding: (actionId) => {
        const { overrides } = get();
        return overrides[actionId] ?? DEFAULT_KEYS_MAP[actionId] ?? [];
      },
    }),
    {
      name: "mymy-shortcuts",
      version: 1,
    }
  )
);

/**
 * Check whether a candidate key combination is already bound to a different
 * action. Returns the conflicting actionId, or null when free.
 */
export function findConflict(
  actionId: string,
  keys: string[]
): string | null {
  const store = useShortcutStore.getState();
  const candidate = keys.join(",").toLowerCase();
  for (const def of DEFAULT_BINDINGS) {
    if (def.actionId === actionId) continue;
    const active = store.getBinding(def.actionId).join(",").toLowerCase();
    if (active === candidate) return def.actionId;
  }
  return null;
}
