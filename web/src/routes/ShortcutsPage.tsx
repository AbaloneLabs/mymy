/**
 * Shortcuts page — command list + keyboard shortcut customization.
 *
 * Layout follows the Settings page pattern (3 columns):
 *   [main sidebar] | [shortcuts tabs] | [content panel]
 *
 * Tabs:
 *   - Commands: read-only list of every palette command, grouped by category.
 *   - Shortcuts: editable bindings with an inline key-capture editor.
 *
 * The active tab is stored in the URL search param `?tab=` so it survives
 * refresh and supports back/forward navigation.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { ShortcutHint } from "@/components/ShortcutHint";
import {
  DEFAULT_COMMANDS,
  commandsByCategory,
  CATEGORY_LABEL_KEYS,
  type CommandCategory,
} from "@/lib/commands";
import {
  DEFAULT_BINDINGS,
  useShortcutStore,
  findConflict,
  type ShortcutCategory,
} from "@/store/shortcuts";
import { cn } from "@/lib/utils";

type ShortcutsTab = "commands" | "shortcuts";

const VALID_TABS: ShortcutsTab[] = ["commands", "shortcuts"];

/** Map command category headings to shortcut categories for display. */
const SHORTCUT_CATEGORY_ORDER: ShortcutCategory[] = [
  "navigation",
  "global",
  "actions",
];

const SHORTCUT_CATEGORY_LABEL: Record<ShortcutCategory, string> = {
  navigation: "commandPalette.categories.navigation",
  global: "commandPalette.categories.global",
  actions: "commandPalette.categories.actions",
};

export default function ShortcutsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: ShortcutsTab =
    rawTab && VALID_TABS.includes(rawTab as ShortcutsTab)
      ? (rawTab as ShortcutsTab)
      : "shortcuts";

  function selectTab(tab: ShortcutsTab) {
    setSearchParams({ tab }, { replace: true });
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">
            {t("commandPalette.shortcutsTitle")}
          </h1>
        </header>

        {/* Body: tab sidebar + content panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left tab sidebar */}
          <nav className="w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            <TabButton
              label={t("commandPalette.tabs.commands")}
              active={activeTab === "commands"}
              onClick={() => selectTab("commands")}
            />
            <TabButton
              label={t("commandPalette.tabs.shortcuts")}
              active={activeTab === "shortcuts"}
              onClick={() => selectTab("shortcuts")}
            />
          </nav>

          {/* Right content panel */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-2xl space-y-6">
              {activeTab === "commands" && <CommandsTab />}
              {activeTab === "shortcuts" && <ShortcutsTab />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ===========================================================================
// Tab button
// ===========================================================================

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--surface-active)] font-medium text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      )}
    >
      {label}
    </button>
  );
}

// ===========================================================================
// Commands tab (read-only)
// ===========================================================================

function CommandsTab() {
  const { t } = useTranslation();
  const grouped = commandsByCategory();
  const order: CommandCategory[] = ["navigation", "create", "actions"];

  return (
    <>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-sm text-[var(--text)]">
          {t("commandPalette.paletteHint")}
        </div>
      </div>

      {order.map((category) => {
        const items = grouped[category];
        if (!items.length) return null;
        return (
          <section
            key={category}
            className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          >
            <h2 className="border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
              {t(CATEGORY_LABEL_KEYS[category])}
            </h2>
            <ul className="divide-y divide-[var(--border)]">
              {items.map((cmd) => (
                <li
                  key={cmd.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <cmd.icon
                    className="h-4 w-4 shrink-0 text-[var(--text-faint)]"
                    strokeWidth={1.5}
                  />
                  <span className="flex-1 text-sm text-[var(--text)]">
                    {t(cmd.labelKey)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ===========================================================================
// Shortcuts tab (editable)
// ===========================================================================

function ShortcutsTab() {
  const { t } = useTranslation();
  const resetAll = useShortcutStore((s) => s.resetAll);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      {/* Reset all */}
      {confirmReset ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <span className="text-sm text-[var(--text-muted)]">
            {t("commandPalette.resetConfirm")}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetAll();
                setConfirmReset(false);
              }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              {t("common.delete")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="text-xs text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]"
        >
          {t("commandPalette.resetAll")}
        </button>
      )}

      {SHORTCUT_CATEGORY_ORDER.map((category) => (
        <section
          key={category}
          className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        >
          <h2 className="border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
            {t(SHORTCUT_CATEGORY_LABEL[category])}
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {DEFAULT_BINDINGS.filter((d) => d.category === category).map(
              (def) => (
                <ShortcutRow key={def.actionId} actionId={def.actionId} />
              )
            )}
          </ul>
        </section>
      ))}
    </>
  );
}

// ===========================================================================
// Shortcut row with inline editor
// ===========================================================================

function ShortcutRow({ actionId }: { actionId: string }) {
  const { t } = useTranslation();
  const getBinding = useShortcutStore((s) => s.getBinding);
  const setShortcut = useShortcutStore((s) => s.setShortcut);
  const resetShortcut = useShortcutStore((s) => s.resetShortcut);

  const keys = getBinding(actionId);
  const isDefault = useShortcutStore((s) => !(actionId in s.overrides));

  const [editing, setEditing] = useState(false);
  const [captured, setCaptured] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<HTMLButtonElement>(null);

  const command = DEFAULT_COMMANDS.find((c) => c.id === actionId);
  const label = command ? t(command.labelKey) : actionId;

  // Focus the capture button when entering edit mode.
  useEffect(() => {
    if (editing && captureRef.current) {
      captureRef.current.focus();
    }
  }, [editing]);

  function startEditing() {
    setEditing(true);
    setCaptured(null);
    setError(null);
  }

  function cancelEditing() {
    setEditing(false);
    setCaptured(null);
    setError(null);
  }

  function saveBinding() {
    if (!captured) {
      cancelEditing();
      return;
    }
    const conflict = findConflict(actionId, captured);
    if (conflict) {
      const conflictCmd = DEFAULT_COMMANDS.find((c) => c.id === conflict);
      setError(
        t("commandPalette.conflictError", {
          label: conflictCmd ? t(conflictCmd.labelKey) : conflict,
        })
      );
      return;
    }
    setShortcut(actionId, captured);
    setEditing(false);
    setCaptured(null);
    setError(null);
  }

  /**
   * Capture a key combination from a keydown event.
   * Modifiers-only presses are ignored; at least one non-modifier key is
   * required. Single-key sequences (e.g. ["g"]) are also ignored for
   * chord-style capture, but single context keys (e.g. ["n"]) are allowed.
   */
  function handleCapture(e: React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels editing.
    if (e.key === "Escape") {
      cancelEditing();
      return;
    }

    const mod = e.metaKey || e.ctrlKey;
    const tokens: string[] = [];
    if (e.metaKey || e.ctrlKey) tokens.push("mod");
    if (e.altKey) tokens.push("alt");
    if (e.shiftKey) tokens.push("shift");

    // Ignore pure modifier presses.
    const MODIFIER_KEYS = new Set([
      "Meta",
      "Control",
      "Alt",
      "Shift",
      "Tab",
    ]);
    if (MODIFIER_KEYS.has(e.key)) {
      return;
    }

    let key = e.key;
    if (key === " ") key = "space";
    if (key.length === 1) key = key.toLowerCase();
    tokens.push(key);

    // A chord must include a modifier; a single plain key is allowed only
    // for context actions (sequences are not editable here).
    if (!mod && tokens.length === 1) {
      // single key — allow (used for context actions like "n")
    }
    setCaptured(tokens);
    setError(null);
    void mod; // referenced for clarity
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1">
        <div className="text-sm text-[var(--text)]">{label}</div>
        {error && (
          <div className="mt-1 text-xs text-[var(--status-error)]">{error}</div>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <button
            ref={captureRef}
            type="button"
            onKeyDown={handleCapture}
            className={cn(
              "flex h-7 min-w-[120px] items-center justify-center rounded-md border px-2",
              captured
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-dashed border-[var(--border-strong)] text-[var(--text-faint)]"
            )}
          >
            {captured ? (
              <ShortcutHint keys={captured} />
            ) : (
              <span className="text-xs">
                {t("commandPalette.pressKeys")}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={saveBinding}
            className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            {t("common.save")}
          </button>
          <button
            type="button"
            onClick={cancelEditing}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ShortcutHint keys={keys} />
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("common.edit")}
          </button>
          {!isDefault && (
            <button
              type="button"
              onClick={() => resetShortcut(actionId)}
              className="text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]"
            >
              {t("commandPalette.reset")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
