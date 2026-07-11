import { Replace, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function FindReplacePanel({
  query,
  replacement,
  matchCase,
  wholeWord,
  regexSearch,
  matchCount,
  searchError,
  scopeLabel,
  onQueryChange,
  onReplacementChange,
  onMatchCaseChange,
  onWholeWordChange,
  onRegexSearchChange,
  onReplaceFirst,
  onReplaceAll,
  onClose,
}: {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
  matchCount: number;
  searchError: string | null;
  scopeLabel: string;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onMatchCaseChange: (matchCase: boolean) => void;
  onWholeWordChange: (wholeWord: boolean) => void;
  onRegexSearchChange: (regexSearch: boolean) => void;
  onReplaceFirst: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <div className="flex min-w-56 flex-1 items-center gap-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("documentEditor.find", { defaultValue: "Find" })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <span className="min-w-16 text-right text-[11px] text-[var(--text-muted)]">
          {searchError ?? (query ? matchCount : 0)}
        </span>
      </div>
      <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
        {scopeLabel}
      </span>
      <div className="flex min-w-56 flex-1 items-center gap-2">
        <Replace className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={replacement}
          onChange={(event) => onReplacementChange(event.target.value)}
          placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </div>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(event) => onMatchCaseChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.matchCase", { defaultValue: "Match case" })}
      </label>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={wholeWord}
          onChange={(event) => onWholeWordChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.wholeWord", { defaultValue: "Whole word" })}
      </label>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={regexSearch}
          onChange={(event) => onRegexSearchChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.regex", { defaultValue: "Regex" })}
      </label>
      <button
        type="button"
        onClick={onReplaceFirst}
        disabled={!query || matchCount === 0 || Boolean(searchError)}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("documentEditor.replace", { defaultValue: "Replace" })}
      </button>
      <button
        type="button"
        onClick={onReplaceAll}
        disabled={!query || matchCount === 0 || Boolean(searchError)}
        className="inline-flex h-8 items-center rounded-md bg-[var(--accent)] px-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("documentEditor.replaceAll", { defaultValue: "Replace all" })}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title={t("common.close")}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
