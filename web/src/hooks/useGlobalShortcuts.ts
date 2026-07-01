/**
 * useGlobalShortcuts — registers all global keyboard shortcuts.
 *
 * Bindings are read from the shortcut store so user overrides are respected.
 *
 * Behavior:
 *   - `mod+K` (palette toggle) works everywhere, including form fields.
 *   - Navigation sequences (`g` then `x`) and context create keys are
 *     disabled while typing in input/textarea/contenteditable.
 *   - Context create keys (T/N/E/C) are only active on their feature pages.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { useShortcutStore, DEFAULT_BINDINGS } from "@/store/shortcuts";
import { toHotkeyString } from "@/lib/platform";
import { useCommandPaletteStore } from "@/store/commandPalette";
import { useCreateBus } from "@/store/createBus";
import { useLockApp } from "@/hooks/useLockApp";

/** Routes where the corresponding single-key create action is active. */
const CONTEXT_CREATE_ROUTES: Record<string, string> = {
  "/tasks": "create.task",
  "/notes": "create.note",
  "/calendar": "create.event",
  "/chat": "create.chat",
};

/** Resolve a navigation action id to its route path. */
const NAV_PATHS: Record<string, string> = {
  "navigate.home": "/",
  "navigate.chat": "/chat",
  "navigate.calendar": "/calendar",
  "navigate.notes": "/notes",
  "navigate.tasks": "/tasks",
  "navigate.knowledge": "/knowledge",
  "navigate.agents": "/agents",
  "navigate.finance": "/finance",
  "navigate.goals": "/goals",
  "navigate.settings": "/settings",
  "navigate.shortcuts": "/shortcuts",
};

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const getBinding = useShortcutStore((s) => s.getBinding);
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const triggerCreate = useCreateBus((s) => s.triggerCreate);
  const lock = useLockApp();

  // --- Palette toggle: works everywhere (including form fields) ---
  const paletteKeys = getBinding("palette.toggle");
  useHotkeys(
    toHotkeyString(paletteKeys),
    (e) => {
      e.preventDefault();
      togglePalette();
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [togglePalette]
  );

  // --- Lock screen ---
  const lockKeys = getBinding("action.lock");
  useHotkeys(
    toHotkeyString(lockKeys),
    (e) => {
      e.preventDefault();
      lock();
    },
    {
      preventDefault: true,
    },
    [lock]
  );

  // --- Navigation sequences (g then x) ---
  // DEFAULT_BINDINGS is a static array, so the hook call order is stable
  // across renders — safe to call inside this forEach. The rules-of-hooks
  // lint rule cannot verify this, so it is disabled for the loop body.
  /* eslint-disable react-hooks/rules-of-hooks */
  const navBindings = DEFAULT_BINDINGS.filter(
    (d) => d.category === "navigation"
  );
  navBindings.forEach((def) => {
    const keys = getBinding(def.actionId);
    const path = NAV_PATHS[def.actionId];
    useHotkeys(
      toHotkeyString(keys),
      (e) => {
        e.preventDefault();
        if (path) navigate(path);
      },
      {
        preventDefault: true,
        sequenceTimeoutMs: 1000,
      },
      [navigate, path]
    );
  });

  // --- Context create actions (single key, per-route) ---
  const activeCreateAction = CONTEXT_CREATE_ROUTES[location.pathname];
  const createActionBindings = DEFAULT_BINDINGS.filter(
    (d) => d.category === "actions"
  );
  createActionBindings.forEach((def) => {
    const isActive = activeCreateAction === def.actionId;
    const keys = getBinding(def.actionId);
    const actionId = def.actionId;
    useHotkeys(
      toHotkeyString(keys),
      (e) => {
        e.preventDefault();
        triggerCreate(actionId);
      },
      {
        enabled: isActive,
        preventDefault: true,
      },
      [triggerCreate, actionId, isActive]
    );
  });
  /* eslint-enable react-hooks/rules-of-hooks */
}

/**
 * Hook for feature pages to subscribe to create-action triggers.
 * Returns a nonce that increments each time the given action fires, so pages
 * can use it as a useEffect dependency to open their creation form.
 */
export function useCreateAction(actionId: string): number {
  const nonce = useCreateBus((s) => s.nonce);
  const lastAction = useCreateBus((s) => s.lastAction);
  return lastAction === actionId ? nonce : 0;
}
