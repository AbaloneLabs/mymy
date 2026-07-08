import { useMemo } from "react";
import {
  blockCommentTokens,
  sourceBracketMatch,
  sourceBracketPairFragments,
  sourceDisplayText,
  sourceMinimapLines,
  sourceSelectionLineFragments,
  sourceVisibleLines,
  textStats,
} from "./textSourceUtils";
import type {
  SourceFoldRange,
  SourceSelectionRange,
  TextEditorKind,
} from "./textSourceUtils";
import { jsonSchemaDiagnostics, sourceDiagnostics } from "./textStructuredUtils";
import { isTabularJson, parseJsonContent } from "./textJsonUtils";
import { sourceLanguageServiceState } from "./textLanguageService";
import type { TextEditorMode } from "./textSourceTypes";

export function useTextEditorDerivedState({
  activeFoldedSourceIds,
  content,
  cursorOffset,
  filePath,
  foldRanges,
  json,
  kind,
  language,
  largeTextMode,
  mode,
  schemaDraft,
  sourceSelectionRanges,
  structured,
}: {
  activeFoldedSourceIds: ReadonlySet<string>;
  content: string;
  cursorOffset: number;
  filePath: string;
  foldRanges: SourceFoldRange[];
  json: boolean;
  kind: TextEditorKind;
  language: string;
  largeTextMode: boolean;
  mode: TextEditorMode;
  schemaDraft: string;
  sourceSelectionRanges: SourceSelectionRange[];
  structured: boolean;
}) {
  const parsedJson = useMemo(
    () => (json && !largeTextMode ? parseJsonContent(content) : undefined),
    [content, json, largeTextMode],
  );
  const tableAvailable = useMemo(
    () => !largeTextMode && isTabularJson(parsedJson),
    [largeTextMode, parsedJson],
  );
  const schemaDiagnostics = useMemo(
    () =>
      largeTextMode ? [] : jsonSchemaDiagnostics(parsedJson, schemaDraft, json),
    [json, largeTextMode, parsedJson, schemaDraft],
  );
  const languageService = useMemo(
    () =>
      largeTextMode
        ? { diagnostics: [], outline: [] }
        : sourceLanguageServiceState(content, language),
    [content, language, largeTextMode],
  );
  const diagnostics = useMemo(
    () =>
      largeTextMode
        ? []
        : [
            ...sourceDiagnostics(content, kind),
            ...schemaDiagnostics,
            ...languageService.diagnostics,
          ],
    [content, kind, languageService.diagnostics, largeTextMode, schemaDiagnostics],
  );
  const diagnosticsByLine = useMemo(() => {
    const byLine = new Map<number, typeof diagnostics>();
    diagnostics.forEach((diagnostic) => {
      if (!diagnostic.line) return;
      byLine.set(diagnostic.line, [
        ...(byLine.get(diagnostic.line) ?? []),
        diagnostic,
      ]);
    });
    return byLine;
  }, [diagnostics]);
  const outline = languageService.outline;
  const stats = useMemo(() => textStats(content), [content]);
  const foldRangeByStart = useMemo(
    () => new Map(foldRanges.map((range) => [range.startLine, range])),
    [foldRanges],
  );
  const visibleSourceLines = useMemo(
    () => sourceVisibleLines(content, foldRanges, activeFoldedSourceIds),
    [activeFoldedSourceIds, content, foldRanges],
  );
  const sourceDisplayContent = useMemo(
    () =>
      activeFoldedSourceIds.size > 0
        ? sourceDisplayText(visibleSourceLines)
        : content,
    [activeFoldedSourceIds, content, visibleSourceLines],
  );
  const minimapLines = useMemo(
    () => (largeTextMode ? [] : sourceMinimapLines(content)),
    [content, largeTextMode],
  );
  const bracketMatch = useMemo(
    () => (largeTextMode ? null : sourceBracketMatch(content, cursorOffset)),
    [content, cursorOffset, largeTextMode],
  );
  const sourceSelectionFragments = useMemo(
    () => sourceSelectionLineFragments(content, sourceSelectionRanges),
    [content, sourceSelectionRanges],
  );
  const bracketPairFragments = useMemo(
    () => (largeTextMode ? [] : sourceBracketPairFragments(content)),
    [content, largeTextMode],
  );
  const blockComments = useMemo(
    () => blockCommentTokens(filePath, kind),
    [filePath, kind],
  );
  const activeMode =
    largeTextMode
      ? "source"
      : mode === "table" && (!json || !tableAvailable)
        ? "source"
        : mode === "tree" && !structured
          ? "source"
          : mode;

  return {
    activeMode,
    blockComments,
    bracketMatch,
    bracketPairFragments,
    diagnostics,
    diagnosticsByLine,
    foldRangeByStart,
    minimapLines,
    outline,
    schemaDiagnostics,
    sourceDisplayContent,
    sourceSelectionFragments,
    stats,
    tableAvailable,
    visibleSourceLines,
  };
}
