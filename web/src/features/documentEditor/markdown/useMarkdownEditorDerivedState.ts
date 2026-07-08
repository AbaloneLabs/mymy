import { useMemo } from "react";
import {
  countMarkdownSearchMatches,
  markdownHeadingAnchors,
  markdownOutline,
  markdownReferences,
  markdownStats,
  markdownTableAtLine,
  markdownTables,
  parseFrontmatter,
  parseFrontmatterFields,
} from "./markdownEditorUtils";
import {
  sourceBracketPairFragments,
  sourceDisplayText,
  sourceMinimapLines,
  sourceSelectionLineFragments,
  sourceVisibleLines,
  type SourceFoldRange,
  type SourceSelectionRange,
} from "../text";

interface MarkdownCursorState {
  line: number;
  offset: number;
}

export function useMarkdownEditorDerivedState({
  activeFoldedSourceIds,
  content,
  cursor,
  foldRanges,
  matchCase,
  regexSearch,
  searchDraft,
  sourceSelectionRanges,
  wholeWord,
}: {
  activeFoldedSourceIds: ReadonlySet<string>;
  content: string;
  cursor: MarkdownCursorState;
  foldRanges: SourceFoldRange[];
  matchCase: boolean;
  regexSearch: boolean;
  searchDraft: string;
  sourceSelectionRanges: SourceSelectionRange[];
  wholeWord: boolean;
}) {
  const lineCount = useMemo(
    () => Math.max(1, content.split("\n").length),
    [content],
  );
  const outline = useMemo(() => markdownOutline(content), [content]);
  const headingAnchors = useMemo(() => markdownHeadingAnchors(outline), [outline]);
  const references = useMemo(() => markdownReferences(content), [content]);
  const activeReference = useMemo(
    () =>
      references.find(
        (reference) =>
          cursor.offset >= reference.start &&
          cursor.offset <= reference.end &&
          (reference.labelStart !== undefined ||
            reference.targetStart !== undefined),
      ) ?? null,
    [cursor.offset, references],
  );
  const tables = useMemo(() => markdownTables(content), [content]);
  const activeTable = useMemo(
    () => markdownTableAtLine(content, cursor.line) ?? tables[0] ?? null,
    [content, cursor.line, tables],
  );
  const frontmatter = useMemo(() => parseFrontmatter(content), [content]);
  const frontmatterFields = useMemo(
    () =>
      frontmatter
        ? parseFrontmatterFields(frontmatter.content, frontmatter.marker)
        : [],
    [frontmatter],
  );
  const stats = useMemo(
    () => markdownStats(content, outline.length),
    [content, outline.length],
  );
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
    () => sourceMinimapLines(content),
    [content],
  );
  const sourceSelectionFragments = useMemo(
    () => sourceSelectionLineFragments(content, sourceSelectionRanges),
    [content, sourceSelectionRanges],
  );
  const bracketPairFragments = useMemo(
    () => sourceBracketPairFragments(content),
    [content],
  );
  const searchMatches = useMemo(
    () =>
      countMarkdownSearchMatches(content, searchDraft, {
        matchCase,
        wholeWord,
        regexSearch,
      }),
    [content, matchCase, regexSearch, searchDraft, wholeWord],
  );

  return {
    activeReference,
    activeTable,
    bracketPairFragments,
    foldRangeByStart,
    frontmatter,
    frontmatterFields,
    headingAnchors,
    lineCount,
    minimapLines,
    outline,
    references,
    searchMatches,
    sourceDisplayContent,
    sourceSelectionFragments,
    stats,
    tables,
    visibleSourceLines,
  };
}
