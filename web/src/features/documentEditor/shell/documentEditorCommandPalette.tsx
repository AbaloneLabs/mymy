import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Command, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  editorCommandsForKind,
  type EditorCommandDefinition,
  type EditorCommandId,
} from "@/features/documentEditor/shared/commands";
import type { DocumentEditorKind } from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

export function CommandPalette({
  kind,
  keymap,
  query,
  onQueryChange,
  onRun,
  onClose,
}: {
  kind: DocumentEditorKind;
  keymap: EditorKeymapEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onRun: (commandId: EditorCommandId) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const normalizedQuery = query.trim().toLowerCase();
  const commands = editorCommandsForKind(kind, keymap).filter((command) => {
    if (!normalizedQuery) return true;
    const label = t(command.labelKey, {
      defaultValue: command.fallbackLabel,
    }).toLowerCase();
    return (
      label.includes(normalizedQuery) ||
      command.id.toLowerCase().includes(normalizedQuery) ||
      command.shortcuts.some((shortcut) =>
        shortcut.display.toLowerCase().includes(normalizedQuery),
      )
    );
  });

  function handlePaletteKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && commands[0]) {
      event.preventDefault();
      onRun(commands[0].id);
    }
  }

  return (
    <div
      className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      onKeyDown={handlePaletteKeyDown}
    >
      <div className="mb-2 flex items-center gap-2">
        <Command className="h-3.5 w-3.5 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("documentEditor.commandPalettePlaceholder", {
            defaultValue: "Search commands",
          })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("common.close")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {commands.map((command) => (
          <CommandPaletteItem
            key={`${command.id}:${command.shortcuts[0]?.display ?? ""}`}
            command={command}
            onRun={onRun}
          />
        ))}
        {commands.length === 0 && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {t("documentEditor.noCommands", { defaultValue: "No commands" })}
          </div>
        )}
      </div>
    </div>
  );
}

function CommandPaletteItem({
  command,
  onRun,
}: {
  command: EditorCommandDefinition;
  onRun: (commandId: EditorCommandId) => void;
}) {
  const { t } = useTranslation();
  const shortcut = command.shortcuts[0]?.display;
  return (
    <button
      type="button"
      onClick={() => onRun(command.id)}
      className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    >
      <span>{t(command.labelKey, { defaultValue: command.fallbackLabel })}</span>
      {shortcut && (
        <kbd className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
