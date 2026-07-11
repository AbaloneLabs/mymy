import { useTranslation } from "react-i18next";
import { toolbarTextButtonClass } from "./textEditorChromeClasses";

type TextEditorSearchBarProps = {
  caseSensitive: boolean;
  largeSearchNavigation:
    | {
        processed: number;
        total: number;
      }
    | null;
  largeTextMode: boolean;
  replaceDraft: string;
  searchDraft: string;
  searchMatches: number;
  searchError: string | null;
  streamingSearchCount:
    | {
        complete: boolean;
        processed: number;
        total: number;
      }
    | null;
  wholeWord: boolean;
  regexSearch: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  onCancelLargeSearch: () => void;
  onFindNext: () => void;
  onRegexSearchChange: (value: boolean) => void;
  onReplaceAll: () => void;
  onReplaceDraftChange: (value: string) => void;
  onReplaceNext: () => void;
  onSearchDraftChange: (value: string) => void;
  onWholeWordChange: (value: boolean) => void;
};

export function TextEditorSearchBar({
  caseSensitive,
  largeSearchNavigation,
  largeTextMode,
  replaceDraft,
  searchDraft,
  searchMatches,
  searchError,
  streamingSearchCount,
  wholeWord,
  regexSearch,
  onCaseSensitiveChange,
  onCancelLargeSearch,
  onFindNext,
  onRegexSearchChange,
  onReplaceAll,
  onReplaceDraftChange,
  onReplaceNext,
  onSearchDraftChange,
  onWholeWordChange,
}: TextEditorSearchBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <input
        value={searchDraft}
        onChange={(event) => onSearchDraftChange(event.currentTarget.value)}
        placeholder={t("documentEditor.find", { defaultValue: "Find" })}
        className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <input
        value={replaceDraft}
        onChange={(event) => onReplaceDraftChange(event.currentTarget.value)}
        placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
        className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <button type="button" onClick={onFindNext} disabled={Boolean(searchError)} className={toolbarTextButtonClass(false)}>
        Next
      </button>
      <button
        type="button"
        onClick={onReplaceNext}
        disabled={largeTextMode || Boolean(searchError)}
        className={toolbarTextButtonClass(false)}
      >
        Replace
      </button>
      <button
        type="button"
        onClick={onReplaceAll}
        disabled={largeTextMode || Boolean(searchError)}
        className={toolbarTextButtonClass(false)}
      >
        All
      </button>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => onCaseSensitiveChange(event.currentTarget.checked)}
        />
        Aa
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={wholeWord}
          onChange={(event) => onWholeWordChange(event.currentTarget.checked)}
        />
        Word
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={regexSearch}
          onChange={(event) => onRegexSearchChange(event.currentTarget.checked)}
        />
        .*
      </label>
      <span className="text-xs text-[var(--text-faint)]">{searchMatches} matches</span>
      {searchError && (
        <span className="text-xs text-[var(--status-error)]">{searchError}</span>
      )}
      {largeTextMode && streamingSearchCount && !streamingSearchCount.complete && (
        <span className="text-xs text-[var(--text-faint)]">
          scanning {Math.round((streamingSearchCount.processed / Math.max(1, streamingSearchCount.total)) * 100)}%
        </span>
      )}
      {largeTextMode && largeSearchNavigation && (
        <span className="text-xs text-[var(--text-faint)]">
          locating {Math.round((largeSearchNavigation.processed / Math.max(1, largeSearchNavigation.total)) * 100)}%
        </span>
      )}
      {largeTextMode &&
        ((streamingSearchCount && !streamingSearchCount.complete) ||
          largeSearchNavigation) && (
          <button
            type="button"
            onClick={onCancelLargeSearch}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            Cancel scan
          </button>
        )}
    </div>
  );
}

type TextEditorGoToLineBarProps = {
  draft: string;
  lineCount: number;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
};

export function TextEditorGoToLineBar({
  draft,
  lineCount,
  onClose,
  onDraftChange,
  onSubmit,
}: TextEditorGoToLineBarProps) {
  const { t } = useTranslation();
  return (
    <form
      className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <span className="text-xs text-[var(--text-muted)]">
        {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
      </span>
      <input
        value={draft}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        type="number"
        min={1}
        max={lineCount}
        className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        autoFocus
      />
      <span className="text-xs text-[var(--text-faint)]">/ {lineCount}</span>
      <button type="submit" className={toolbarTextButtonClass(false)}>
        Go
      </button>
    </form>
  );
}
