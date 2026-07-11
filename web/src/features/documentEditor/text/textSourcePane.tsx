import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  UIEvent,
} from "react";
import { useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import type { SourceDiagnostic } from "./textStructuredUtils";
import type {
  SourceBracketPairFragment,
  SourceFoldRange,
  SourceSelectionLineFragment,
  SourceVisibleLine,
} from "./textSourceUtils";

interface SourceMinimapLine {
  line: number;
  text: string;
}

export function TextSourcePane({
  sourceRef,
  lineNumberRef,
  sourceDisplayContent,
  visibleSourceLines,
  foldRangeByStart,
  activeFoldedSourceIds,
  diagnosticsByLine,
  selectionFragments = [],
  bracketFragments = [],
  minimapLines,
  cursorLine,
  sourceScrollLeft = 0,
  sourceScrollTop,
  onContentChange,
  onKeyDown,
  onPaste,
  onCursorUpdate,
  onScroll,
  onFocusLine,
  onToggleFold,
}: {
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  lineNumberRef: RefObject<HTMLDivElement | null>;
  sourceDisplayContent: string;
  visibleSourceLines: SourceVisibleLine[];
  foldRangeByStart: Map<number, SourceFoldRange>;
  activeFoldedSourceIds: ReadonlySet<string>;
  diagnosticsByLine: Map<number, SourceDiagnostic[]>;
  selectionFragments?: SourceSelectionLineFragment[];
  bracketFragments?: SourceBracketPairFragment[];
  minimapLines: SourceMinimapLine[];
  cursorLine: number;
  sourceScrollLeft?: number;
  sourceScrollTop: number;
  onContentChange: (content: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onCursorUpdate: () => void;
  onScroll: (event: UIEvent<HTMLTextAreaElement>) => void;
  onFocusLine: (line: number) => void;
  onToggleFold: (range: SourceFoldRange) => void;
}) {
  useLayoutEffect(() => {
    const source = sourceRef.current;
    if (source) {
      source.scrollTop = sourceScrollTop;
      source.scrollLeft = sourceScrollLeft;
    }
    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = sourceScrollTop;
    }
  }, [lineNumberRef, sourceRef, sourceScrollLeft, sourceScrollTop]);

  const selectionFragmentsByLine = new Map<number, SourceSelectionLineFragment[]>();
  selectionFragments.forEach((fragment) => {
    selectionFragmentsByLine.set(fragment.line, [
      ...(selectionFragmentsByLine.get(fragment.line) ?? []),
      fragment,
    ]);
  });
  const bracketFragmentsByLine = new Map<number, SourceBracketPairFragment[]>();
  bracketFragments.forEach((fragment) => {
    bracketFragmentsByLine.set(fragment.line, [
      ...(bracketFragmentsByLine.get(fragment.line) ?? []),
      fragment,
    ]);
  });

  return (
    <div className="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)_64px] overflow-hidden bg-[var(--bg)]">
      <div
        ref={lineNumberRef}
        className="select-none overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] py-4 font-mono text-xs leading-6 text-[var(--text-faint)]"
      >
        {visibleSourceLines.map((line) => {
          const range = foldRangeByStart.get(line.line);
          const folded = range ? activeFoldedSourceIds.has(range.id) : false;
          const lineDiagnostics = diagnosticsByLine.get(line.line) ?? [];
          return (
            <div
              key={`${line.line}:${line.foldId ?? "open"}`}
              className={cn(
                "grid h-6 grid-cols-[20px_14px_48px] items-center px-2",
                lineDiagnostics.length > 0 &&
                  "bg-[var(--status-warning)]/10 text-[var(--status-warning)]",
              )}
            >
              {range ? (
                <button
                  type="button"
                  onClick={() => onToggleFold(range)}
                  className="h-5 w-5 rounded text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  title={range.label}
                  aria-label={folded ? `Expand line ${line.line}` : `Fold line ${line.line}`}
                >
                  {folded ? ">" : "v"}
                </button>
              ) : (
                <span />
              )}
              {lineDiagnostics.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onFocusLine(line.line)}
                  className="mx-auto h-2 w-2 rounded-full bg-[var(--status-warning)]"
                  title={lineDiagnostics
                    .map((diagnostic) => diagnostic.message)
                    .join("\n")}
                  aria-label={`Diagnostics on line ${line.line}`}
                />
              ) : (
                <span />
              )}
              <span className="text-right">{line.line}</span>
            </div>
          );
        })}
      </div>
      <div
        className="relative min-h-0 overflow-hidden bg-[var(--bg)]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, transparent 0, transparent calc(2ch - 1px), rgba(148, 163, 184, 0.12) calc(2ch - 1px), rgba(148, 163, 184, 0.12) 2ch)",
          backgroundOrigin: "content-box",
          tabSize: 2,
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 p-4 font-mono text-sm leading-6 text-transparent"
          style={{
            transform: `translateY(-${sourceScrollTop}px)`,
            tabSize: 2,
          }}
        >
          {visibleSourceLines.map((line) => {
            const lineDiagnostics = diagnosticsByLine.get(line.line) ?? [];
            const lineSelectionFragments = selectionFragmentsByLine.get(line.line) ?? [];
            const lineBracketFragments = bracketFragmentsByLine.get(line.line) ?? [];
            return (
              <div
                key={`diagnostic:${line.line}:${line.foldId ?? "open"}`}
                className="relative h-6"
              >
                {lineSelectionFragments.map((fragment, index) => (
                  <span
                    key={`${fragment.startColumn}:${fragment.endColumn}:${index}`}
                    className={cn(
                      "absolute top-0 h-6 rounded-sm bg-[var(--accent)]/20",
                      fragment.caret && "w-px bg-[var(--accent)]/80",
                    )}
                    style={{
                      left: `${fragment.startColumn}ch`,
                      width: fragment.caret
                        ? undefined
                        : `${Math.max(0.25, fragment.endColumn - fragment.startColumn)}ch`,
                    }}
                  />
                ))}
                {lineBracketFragments.map((fragment, index) => (
                  <span
                    key={`bracket:${fragment.column}:${index}`}
                    className={cn(
                      "absolute top-0 h-6 w-[1ch] rounded-sm border-b",
                      bracketPairClass(fragment.level, fragment.matched),
                    )}
                    style={{ left: `${fragment.column}ch` }}
                  />
                ))}
                {diagnosticFragments(lineDiagnostics, line.text).map((fragment, index) => (
                  <span
                    key={`diagnostic-fragment:${fragment.startColumn}:${fragment.endColumn}:${index}`}
                    className="absolute top-0 h-6 rounded-sm border-b border-dotted border-[var(--status-warning)] bg-[var(--status-warning)]/10"
                    style={{
                      left: `${fragment.startColumn}ch`,
                      width: `${Math.max(0.5, fragment.endColumn - fragment.startColumn)}ch`,
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <textarea
          ref={sourceRef}
          value={sourceDisplayContent}
          onChange={(event) => onContentChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={onCursorUpdate}
          onKeyUp={onCursorUpdate}
          onClick={onCursorUpdate}
          onScroll={onScroll}
          readOnly={activeFoldedSourceIds.size > 0}
          spellCheck={false}
          className="relative z-10 h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-6 text-[var(--text)] outline-none"
          style={{ tabSize: 2 }}
        />
      </div>
      <div className="min-h-0 overflow-hidden border-l border-[var(--border)] bg-[var(--surface)] px-1 py-2">
        <div
          className="grid h-full gap-px"
          style={{
            gridTemplateRows: `repeat(${Math.max(1, minimapLines.length)}, minmax(1px, 1fr))`,
          }}
        >
          {minimapLines.map((line) => {
            const lineDiagnostics = diagnosticsByLine.get(line.line) ?? [];
            return (
              <button
                key={`${line.line}:${line.text}`}
                type="button"
                onClick={() => onFocusLine(line.line)}
                className={cn(
                  "block min-h-px w-full overflow-hidden rounded-[1px] bg-[var(--text-faint)]/25 text-left text-[3px] leading-none text-transparent hover:bg-[var(--accent)]/60",
                  lineDiagnostics.length > 0 &&
                    "bg-[var(--status-warning)]/70",
                  cursorLine === line.line &&
                    "bg-[var(--accent)] text-transparent",
                )}
                title={`L${line.line}: ${line.text.trim()}`}
                aria-label={`Go to line ${line.line}`}
              >
                {line.text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function bracketPairClass(level: number, matched: boolean) {
  if (!matched) {
    return "border-[var(--status-warning)] bg-[var(--status-warning)]/20";
  }
  const colors = [
    "border-sky-500/70 bg-sky-500/15",
    "border-emerald-500/70 bg-emerald-500/15",
    "border-amber-500/70 bg-amber-500/15",
    "border-fuchsia-500/70 bg-fuchsia-500/15",
  ];
  return colors[level % colors.length];
}

function diagnosticFragments(diagnostics: SourceDiagnostic[], text: string) {
  return diagnostics.map((diagnostic) => {
    const startColumn =
      typeof diagnostic.column === "number" && Number.isFinite(diagnostic.column)
        ? Math.max(0, diagnostic.column - 1)
        : 0;
    const length =
      typeof diagnostic.length === "number" && Number.isFinite(diagnostic.length)
        ? Math.max(1, diagnostic.length)
        : Math.max(6, text.length);
    return {
      startColumn,
      endColumn: Math.max(startColumn + 1, startColumn + length),
    };
  });
}
