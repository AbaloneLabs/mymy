import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TextModel } from "../shared/models";
import type { SourceCompletionItem, SourceHoverInfo } from "./textLanguageService";
import type {
  SourceBracketMatch,
  SourceOutlineItem,
} from "./textSourceUtils";
import { lineEndingLabel } from "./textSourceUtils";
import type { SourceDiagnostic } from "./textStructuredUtils";

export function TextEditorLargeFileWarning() {
  return (
    <div className="shrink-0 border-b border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
      Large file mode: only the visible line window is editable to keep rendering bounded.
    </div>
  );
}

type TextEditorDiagnosticsBarProps = {
  diagnostics: SourceDiagnostic[];
  onFocusLine: (line: number) => void;
};

export function TextEditorDiagnosticsBar({
  diagnostics,
  onFocusLine,
}: TextEditorDiagnosticsBarProps) {
  return (
    <div className="shrink-0 border-b border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
      {diagnostics.map((diagnostic) => (
        <button
          key={`${diagnostic.line}:${diagnostic.path}:${diagnostic.message}`}
          type="button"
          onClick={() => {
            if (diagnostic.line) onFocusLine(diagnostic.line);
          }}
          disabled={!diagnostic.line}
          className="block w-full rounded px-1 py-0.5 text-left disabled:cursor-default"
        >
          {diagnostic.line ? `L${diagnostic.line}: ` : ""}
          {diagnostic.path ? `${diagnostic.path}: ` : ""}
          {diagnostic.message}
        </button>
      ))}
    </div>
  );
}

type TextEditorOutlinePanelProps = {
  outline: SourceOutlineItem[];
  onClose: () => void;
  onFocusLine: (line: number) => void;
};

export function TextEditorOutlinePanel({
  outline,
  onClose,
  onFocusLine,
}: TextEditorOutlinePanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
        <span className="text-xs font-semibold text-[var(--text)]">
          {t("documentEditor.outline", { defaultValue: "Outline" })}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.close")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {outline.length === 0 ? (
          <p className="text-xs text-[var(--text-faint)]">
            {t("documentEditor.noOutline", { defaultValue: "No symbols yet." })}
          </p>
        ) : (
          <div className="space-y-1">
            {outline.map((item) => (
              <button
                key={`${item.line}:${item.kind}:${item.label}`}
                type="button"
                onClick={() => onFocusLine(item.line)}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
              >
                <div className="truncate text-xs font-medium text-[var(--text)]">
                  {item.label}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-faint)]">
                  <span>{item.kind}</span>
                  <span>L{item.line}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

type TextEditorLanguageAssistPanelProps = {
  completions: SourceCompletionItem[];
  hoverInfo: SourceHoverInfo | null;
  onApplyCompletion: (completion: SourceCompletionItem) => void;
  onClose: () => void;
};

export function TextEditorLanguageAssistPanel({
  completions,
  hoverInfo,
  onApplyCompletion,
  onClose,
}: TextEditorLanguageAssistPanelProps) {
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {hoverInfo && (
            <div className="mb-2 truncate font-mono text-xs text-[var(--text-muted)]">
              {hoverInfo.label}: {hoverInfo.detail}
            </div>
          )}
          {completions.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-1">
              {completions.map((completion) => (
                <button
                  key={`${completion.kind}:${completion.label}`}
                  type="button"
                  onClick={() => onApplyCompletion(completion)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                  title={completion.detail ?? completion.kind}
                >
                  <span className="text-[var(--accent)]">{completion.label}</span>
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {completion.kind}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title="Close"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

type TextEditorStatusBarProps = {
  bracketMatch: SourceBracketMatch | null;
  cursor: {
    column: number;
    line: number;
    selection: number;
  };
  largeTextMode: boolean;
  lineEnding: TextModel["lineEnding"];
  pasteProgress: {
    processed: number;
    total: number;
  } | null;
  sourceSelectionCount: number;
  stats: {
    characters: number;
    lines: number;
  };
};

export function TextEditorStatusBar({
  bracketMatch,
  cursor,
  largeTextMode,
  lineEnding,
  pasteProgress,
  sourceSelectionCount,
  stats,
}: TextEditorStatusBarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
      <span>
        L{cursor.line}:C{cursor.column}
        {cursor.selection > 0 ? ` · ${cursor.selection} selected` : ""}
        {sourceSelectionCount > 1 ? ` · ${sourceSelectionCount} cursors` : ""}
        {largeTextMode ? " · virtual edit" : ""}
        {pasteProgress
          ? ` · pasting ${Math.round((pasteProgress.processed / Math.max(1, pasteProgress.total)) * 100)}%`
          : ""}
      </span>
      {bracketMatch && (
        <span
          className={cn(
            "hidden min-w-0 truncate px-3 font-mono sm:inline",
            bracketMatch.matched ? "text-[var(--text-muted)]" : "text-[var(--status-warning)]",
          )}
        >
          {bracketMatch.matched
            ? `${bracketMatch.open.char} L${bracketMatch.open.line}:C${bracketMatch.open.column} <-> ${bracketMatch.close.char} L${bracketMatch.close.line}:C${bracketMatch.close.column}`
            : `${bracketMatch.focus.char} unmatched at L${bracketMatch.focus.line}:C${bracketMatch.focus.column}`}
        </span>
      )}
      <span>
        {stats.lines} lines · {stats.characters} chars · {lineEndingLabel(lineEnding)}
      </span>
    </div>
  );
}
