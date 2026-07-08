import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShortcutHint } from "@/components/ShortcutHint";
import { DEFAULT_COMMANDS } from "@/lib/commands";
import {
  findConflict,
  useShortcutStore,
} from "@/store/shortcuts";
import { cn } from "@/lib/utils";

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "Tab"]);

export function ShortcutRow({ actionId }: { actionId: string }) {
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
        }),
      );
      return;
    }
    setShortcut(actionId, captured);
    setEditing(false);
    setCaptured(null);
    setError(null);
  }

  function handleCapture(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      cancelEditing();
      return;
    }

    const tokens: string[] = [];
    if (event.metaKey || event.ctrlKey) tokens.push("mod");
    if (event.altKey) tokens.push("alt");
    if (event.shiftKey) tokens.push("shift");

    if (MODIFIER_KEYS.has(event.key)) {
      return;
    }

    let key = event.key;
    if (key === " ") key = "space";
    if (key.length === 1) key = key.toLowerCase();
    tokens.push(key);

    setCaptured(tokens);
    setError(null);
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
                : "border-dashed border-[var(--border-strong)] text-[var(--text-faint)]",
            )}
          >
            {captured ? (
              <ShortcutHint keys={captured} />
            ) : (
              <span className="text-xs">{t("commandPalette.pressKeys")}</span>
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
