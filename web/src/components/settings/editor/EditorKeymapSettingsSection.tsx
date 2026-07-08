import { useState } from "react";
import { Keyboard, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  editorCommandsForKind,
  type EditorCommandDefinition,
  type EditorCommandId,
  type EditorShortcut,
} from "@/features/documentEditor/shared/commands";
import type { DocumentEditorKind } from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

const keymapEditorKinds: Array<{ kind: DocumentEditorKind; label: string }> = [
  { kind: "text", label: "Text / JSON / YAML / TOML" },
  { kind: "markdown", label: "Markdown" },
  { kind: "docx", label: "DOCX" },
  { kind: "xlsx", label: "XLSX / CSV / TSV" },
  { kind: "pptx", label: "PPTX" },
];

export function EditorKeymapSection({
  selectedKind,
  onSelectedKindChange,
  keymapEntries,
  loading,
  saving,
  onSave,
}: {
  selectedKind: DocumentEditorKind;
  onSelectedKindChange: (kind: DocumentEditorKind) => void;
  keymapEntries: EditorKeymapEntry[];
  loading: boolean;
  saving: boolean;
  onSave: (shortcuts: EditorKeymapEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const defaultCommands = uniqueCommands(editorCommandsForKind(selectedKind));
  const effectiveCommands = uniqueCommands(editorCommandsForKind(selectedKind, keymapEntries));

  function setShortcut(commandId: EditorCommandId, shortcut: EditorShortcut) {
    const conflict = effectiveCommands.find(
      (command) =>
        command.id !== commandId && shortcutsEqual(command.shortcuts[0], shortcut),
    );
    if (conflict) {
      setShortcutError(
        t("settings.editor.keymapConflict", {
          command: t(conflict.labelKey, { defaultValue: conflict.fallbackLabel }),
          defaultValue: "Shortcut already used by {command}.",
        }),
      );
      return;
    }
    setShortcutError(null);
    const next = [
      ...keymapEntries.filter(
        (entry) => !(entry.editorKind === selectedKind && entry.commandId === commandId),
      ),
      {
        editorKind: selectedKind,
        commandId,
        shortcut: {
          key: shortcut.key,
          display: shortcut.display,
          primary: Boolean(shortcut.primary),
          shift: Boolean(shortcut.shift),
          alt: Boolean(shortcut.alt),
        },
      },
    ];
    onSave(next);
  }

  function resetShortcut(commandId: EditorCommandId) {
    setShortcutError(null);
    onSave(
      keymapEntries.filter(
        (entry) => !(entry.editorKind === selectedKind && entry.commandId === commandId),
      ),
    );
  }

  function resetKind() {
    setShortcutError(null);
    onSave(keymapEntries.filter((entry) => entry.editorKind !== selectedKind));
  }

  return (
    <section className="space-y-3 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("settings.editor.keymapTitle", { defaultValue: "Keyboard shortcuts" })}
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("settings.editor.keymapDescription", {
              defaultValue: "Customize editor shortcuts by file type.",
            })}
          </p>
        </div>
        <select
          value={selectedKind}
          onChange={(event) => {
            setShortcutError(null);
            onSelectedKindChange(event.target.value as DocumentEditorKind);
          }}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          {keymapEditorKinds.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={resetKind}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
          {t("common.reset", { defaultValue: "Reset" })}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("common.loading")}
        </div>
      ) : (
        <>
          {shortcutError && (
            <div className="rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-3 py-2 text-sm text-[var(--status-warning)]">
              {shortcutError}
            </div>
          )}
          <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)]">
            {defaultCommands.map((command) => {
              const effective =
                effectiveCommands.find((item) => item.id === command.id) ?? command;
              const overridden = keymapEntries.some(
                (entry) => entry.editorKind === selectedKind && entry.commandId === command.id,
              );
              return (
                <div
                  key={command.id}
                  className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(160px,1fr)_minmax(140px,220px)_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text)]">
                      {t(command.labelKey, { defaultValue: command.fallbackLabel })}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--text-faint)]">
                      {command.id}
                    </div>
                  </div>
                  <ShortcutCaptureButton
                    command={command}
                    effective={effective}
                    disabled={saving}
                    onCapture={(shortcut) => setShortcut(command.id, shortcut)}
                  />
                  <button
                    type="button"
                    onClick={() => resetShortcut(command.id)}
                    disabled={!overridden || saving}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t("common.reset", { defaultValue: "Reset" })}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ShortcutCaptureButton({
  command,
  effective,
  disabled,
  onCapture,
}: {
  command: EditorCommandDefinition;
  effective: EditorCommandDefinition;
  disabled: boolean;
  onCapture: (shortcut: EditorShortcut) => void;
}) {
  const { t } = useTranslation();
  const shortcut = effective.shortcuts[0] ?? command.shortcuts[0];
  return (
    <button
      type="button"
      disabled={disabled}
      onKeyDown={(event) => {
        const next = shortcutFromEvent(event);
        if (!next) return;
        event.preventDefault();
        onCapture(next);
      }}
      className="inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      title={t("settings.editor.captureShortcut", {
        defaultValue: "Focus and press a new shortcut",
      })}
    >
      <Keyboard className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <kbd className="truncate font-mono text-[11px] text-[var(--text)]">
        {shortcut?.display ?? "-"}
      </kbd>
    </button>
  );
}

function uniqueCommands(commands: EditorCommandDefinition[]) {
  const seen = new Set<EditorCommandId>();
  return commands.filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

function shortcutsEqual(left: EditorShortcut | undefined, right: EditorShortcut) {
  if (!left) return false;
  return (
    left.key.toLowerCase() === right.key.toLowerCase() &&
    Boolean(left.primary) === Boolean(right.primary) &&
    Boolean(left.shift) === Boolean(right.shift) &&
    Boolean(left.alt) === Boolean(right.alt)
  );
}

function shortcutFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): EditorShortcut | null {
  if (event.nativeEvent.isComposing) return null;
  const key = normalizeShortcutKey(event.key);
  if (!key || key === "Control" || key === "Meta" || key === "Shift" || key === "Alt") {
    return null;
  }
  const shortcut: EditorShortcut = {
    key,
    display: displayShortcut({
      key,
      primary: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    }),
    primary: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
  return shortcut;
}

function normalizeShortcutKey(key: string) {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function displayShortcut(shortcut: Omit<EditorShortcut, "display">) {
  const parts = [];
  if (shortcut.primary) parts.push("Ctrl/Cmd");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.alt) parts.push("Alt");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join("+");
}
