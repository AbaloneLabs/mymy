interface MarkdownEditorCursor {
  line: number;
  column: number;
  selection: number;
}

interface MarkdownEditorStats {
  lines: number;
  words: number;
  characters: number;
  headings: number;
}

export function MarkdownEditorStatusBar({
  cursor,
  pasteProgress,
  sourceSelectionCount,
  stats,
}: {
  cursor: MarkdownEditorCursor;
  pasteProgress: { processed: number; total: number } | null;
  sourceSelectionCount: number;
  stats: MarkdownEditorStats;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
      <span>
        L{cursor.line}:C{cursor.column}
        {cursor.selection > 0 ? ` \u00b7 ${cursor.selection} selected` : ""}
        {sourceSelectionCount > 1 ? ` \u00b7 ${sourceSelectionCount} cursors` : ""}
        {pasteProgress
          ? ` \u00b7 pasting ${Math.round((pasteProgress.processed / Math.max(1, pasteProgress.total)) * 100)}%`
          : ""}
      </span>
      <span>
        {stats.lines} lines {"\u00b7"} {stats.words} words {"\u00b7"}{" "}
        {stats.characters} chars {"\u00b7"} {stats.headings} headings
      </span>
    </div>
  );
}
