export {
  startChunkedSearchCount,
  startChunkedSearchRange,
  startChunkedSourcePaste,
} from "./textSourceAsync";
export { autoPairSource, isPotentialSourceEditKey } from "./textSourceAutoPairs";
export { sourceBracketMatch, sourceBracketPairFragments } from "./textSourceBrackets";
export {
  activeSourceFoldIds,
  sourceDisplayText,
  sourceMinimapLines,
} from "./textSourceDisplay";
export {
  blockCommentTokens,
  lineCommentToken,
  toggleBlockCommentRange,
  toggleCommentLine,
} from "./textSourceComments";
export {
  duplicateSelectedLines,
  indentTextLine,
  moveSelectedLines,
  outdentTextLine,
  selectedLineRange,
  transformSelectedLines,
} from "./textSourceLineEditing";
export {
  languageForPath,
  textEditorKind,
} from "./textSourceMetadata";
export {
  buildSearchRegex,
  countSearchMatches,
  countTextLines,
  cursorPosition,
  hasTrailingTextNewline,
  lineEndingLabel,
  lineEndingValue,
  nextSearchRange,
  offsetForTextLine,
  sourceFoldRanges,
  sourceVisibleLines,
  textSourceOutline,
  textStats,
} from "./textSourceNavigation";
export {
  applySourceSelectionDelete,
  applySourceSelectionTextEdit,
  normalizeSourceSelectionRanges,
  rectangularSourceSelectionRanges,
  sourceNextOccurrenceRanges,
  sourceSelectionLineFragments,
} from "./textSourceSelections";
export type {
  ChunkedSearchCountOptions,
  ChunkedSearchRangeOptions,
  ChunkedSourcePasteOptions,
  SearchOptions,
  SourceAsyncProgress,
  SourceBracketMatch,
  SourceBracketPairFragment,
  SourceBracketPosition,
  SourceEdit,
  SourceFoldRange,
  SourceMinimapLine,
  SourceMultiCursorEdit,
  SourceOutlineItem,
  SourceSelectionLineFragment,
  SourceSelectionRange,
  SourceVisibleLine,
  TextEditorKind,
  TextEditorMode,
} from "./textSourceTypes";
