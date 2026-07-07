import { useTranslation } from "react-i18next";
import { markdownTextButtonClass } from "./markdownEditorChrome";

export function MarkdownSearchBar({
  searchDraft,
  replaceDraft,
  matchCase,
  wholeWord,
  regexSearch,
  searchMatches,
  onSearchDraftChange,
  onReplaceDraftChange,
  onFindNext,
  onReplaceNext,
  onReplaceAll,
  onMatchCaseChange,
  onWholeWordChange,
  onRegexSearchChange,
}: {
  searchDraft: string;
  replaceDraft: string;
  matchCase: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
  searchMatches: number;
  onSearchDraftChange: (value: string) => void;
  onReplaceDraftChange: (value: string) => void;
  onFindNext: () => void;
  onReplaceNext: () => void;
  onReplaceAll: () => void;
  onMatchCaseChange: (value: boolean) => void;
  onWholeWordChange: (value: boolean) => void;
  onRegexSearchChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <input
        value={searchDraft}
        onChange={(event) => onSearchDraftChange(event.target.value)}
        placeholder={t("documentEditor.find", { defaultValue: "Find" })}
        className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <input
        value={replaceDraft}
        onChange={(event) => onReplaceDraftChange(event.target.value)}
        placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
        className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <button type="button" onClick={onFindNext} className={markdownTextButtonClass()}>
        Next
      </button>
      <button type="button" onClick={onReplaceNext} className={markdownTextButtonClass()}>
        Replace
      </button>
      <button type="button" onClick={onReplaceAll} className={markdownTextButtonClass()}>
        All
      </button>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(event) => onMatchCaseChange(event.target.checked)}
        />
        Aa
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={wholeWord}
          onChange={(event) => onWholeWordChange(event.target.checked)}
        />
        Word
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={regexSearch}
          onChange={(event) => onRegexSearchChange(event.target.checked)}
        />
        .*
      </label>
      <span className="text-xs text-[var(--text-faint)]">{searchMatches} matches</span>
    </div>
  );
}

export function MarkdownGoToLineBar({
  draft,
  lineCount,
  onDraftChange,
  onSubmit,
  onClose,
}: {
  draft: string;
  lineCount: number;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
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
        onChange={(event) => onDraftChange(event.target.value)}
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
      <button type="submit" className={markdownTextButtonClass()}>
        Go
      </button>
    </form>
  );
}
