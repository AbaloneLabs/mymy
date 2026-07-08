import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Braces,
  Copy,
  FileCog,
  FilePlus,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  MessageSquare,
  Pilcrow,
  Rows3,
  Save,
  Search,
  Table,
  Trash2,
  WrapText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/chat/codeHighlight";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import type { TextModel } from "../models";
import {
  autoPairSource,
  activeSourceFoldIds,
  blockCommentTokens,
  buildSearchRegex,
  countSearchMatches,
  countTextLines,
  cursorPosition,
  duplicateSelectedLines,
  hasTrailingTextNewline,
  indentTextLine,
  languageForPath,
  lineCommentToken,
  lineEndingLabel,
  lineEndingValue,
  moveSelectedLines,
  nextSearchRange,
  offsetForTextLine,
  outdentTextLine,
  selectedLineRange,
  sourceBracketMatch,
  sourceBracketPairFragments,
  sourceDisplayText,
  sourceFoldRanges,
  sourceMinimapLines,
  sourceSelectionLineFragments,
  sourceVisibleLines,
  startChunkedSearchCount,
  startChunkedSearchRange,
  textEditorKind,
  textSourceOutline,
  textStats,
  toggleBlockCommentRange,
  toggleCommentLine,
  transformSelectedLines,
  isPotentialSourceEditKey,
} from "../textSourceUtils";
import type { SourceFoldRange, SourceSelectionRange } from "../textSourceUtils";
import { jsonSchemaDiagnostics, sourceDiagnostics } from "../textStructuredUtils";
import { isTabularJson, parseJsonContent, sortJsonValue } from "../textJsonUtils";
import { JsonPreview, JsonTableEditor, StructuredJsonEditor } from "../textJsonEditors";
import {
  createJsonSchemaRegistryEntry,
  jsonSchemaParseError,
  loadJsonSchemaRegistry,
  saveJsonSchemaRegistry,
  schemaNameFromPath,
  updateJsonSchemaRegistryEntry,
} from "../textSchemaRegistry";
import {
  ConfigPreview,
  FlatConfigEditor,
  LargeTextSourceViewer,
} from "../textConfigEditors";
import { TextSourcePane } from "../textSourcePane";
import { useTextSourceEditing } from "../useTextSourceEditing";

type TextEditorMode = "source" | "tree" | "table" | "preview";

const LARGE_TEXT_FILE_CHAR_LIMIT = 1_000_000;
const LARGE_TEXT_FILE_LINE_LIMIT = 50_000;

interface LargeSearchSignature {
  caseSensitive: boolean;
  content: string;
  query: string;
  regexSearch: boolean;
  wholeWord: boolean;
}

export function PlainTextEditor({
  filePath,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  filePath: string;
  model: TextModel;
  onChange: (model: TextModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const { t } = useTranslation();
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const searchCountCancelRef = useRef<(() => void) | null>(null);
  const searchRangeCancelRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<TextEditorMode>("source");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineDraft, setGoToLineDraft] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState("");
  const [schemaNameDraft, setSchemaNameDraft] = useState(() => schemaNameFromPath(filePath));
  const [schemaRegistry, setSchemaRegistry] = useState(loadJsonSchemaRegistry);
  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [foldedSourceIds, setFoldedSourceIds] = useState<Set<string>>(() => new Set());
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [cursor, setCursor] = useState({
    line: 1,
    column: 1,
    selection: 0,
    offset: 0,
  });
  const [streamingSearchCount, setStreamingSearchCount] = useState<{
    query: string;
    count: number;
    processed: number;
    total: number;
    complete: boolean;
  } | null>(null);
  const [largeSearchResult, setLargeSearchResult] = useState<{
    range: SourceSelectionRange | null;
    signature: LargeSearchSignature;
  } | null>(null);
  const [largeSearchNavigation, setLargeSearchNavigation] = useState<{
    processed: number;
    total: number;
    signature: LargeSearchSignature;
  } | null>(null);
  const kind = textEditorKind(filePath);
  const language = languageForPath(filePath, kind);
  const structured = kind === "json" || kind === "yaml" || kind === "toml";
  const json = kind === "json";
  const lineCount = countTextLines(model.content);
  const largeTextMode =
    model.content.length > LARGE_TEXT_FILE_CHAR_LIMIT ||
    lineCount > LARGE_TEXT_FILE_LINE_LIMIT;
  const parsedJson = json && !largeTextMode ? parseJsonContent(model.content) : undefined;
  const tableAvailable = !largeTextMode && isTabularJson(parsedJson);
  const schemaDiagnostics = largeTextMode
    ? []
    : jsonSchemaDiagnostics(parsedJson, schemaDraft, json);
  const schemaDraftError = jsonSchemaParseError(schemaDraft);
  const selectedSchema = schemaRegistry.find((entry) => entry.id === selectedSchemaId);
  const diagnostics = largeTextMode
    ? []
    : [
        ...sourceDiagnostics(model.content, kind),
        ...schemaDiagnostics,
      ];
  const diagnosticsByLine = new Map<number, typeof diagnostics>();
  diagnostics.forEach((diagnostic) => {
    if (!diagnostic.line) return;
    diagnosticsByLine.set(diagnostic.line, [
      ...(diagnosticsByLine.get(diagnostic.line) ?? []),
      diagnostic,
    ]);
  });
  const outline = largeTextMode ? [] : textSourceOutline(model.content, language);
  const stats = textStats(model.content);
  const foldRanges = largeTextMode ? [] : sourceFoldRanges(model.content, language);
  const activeFoldedSourceIds = activeSourceFoldIds(foldedSourceIds, foldRanges);
  const foldRangeByStart = new Map(foldRanges.map((range) => [range.startLine, range]));
  const visibleSourceLines = sourceVisibleLines(model.content, foldRanges, activeFoldedSourceIds);
  const sourceDisplayContent =
    activeFoldedSourceIds.size > 0 ? sourceDisplayText(visibleSourceLines) : model.content;
  const {
    activateRectangularSourceSelection,
    addNextSourceSelection,
    applySourceEdit,
    clearSourceSelections,
    handleSourceMultiCursorKey,
    handleSourcePaste,
    pasteProgress,
    setSourceSelectionRanges,
    sourceSelectionRanges,
    withTextareaSelection,
  } = useTextSourceEditing({
    content: model.content,
    folded: activeFoldedSourceIds.size > 0,
    sourceRef,
    updateContent,
    unfoldAll: () => setFoldedSourceIds(new Set()),
    updateCursor,
    syncLineNumberScroll,
  });
  const minimapLines = useMemo(
    () => (largeTextMode ? [] : sourceMinimapLines(model.content)),
    [largeTextMode, model.content],
  );
  const bracketMatch = useMemo(
    () => (largeTextMode ? null : sourceBracketMatch(model.content, cursor.offset)),
    [cursor.offset, largeTextMode, model.content],
  );
  const sourceSelectionFragments = useMemo(
    () => sourceSelectionLineFragments(model.content, sourceSelectionRanges),
    [model.content, sourceSelectionRanges],
  );
  const bracketPairFragments = useMemo(
    () => (largeTextMode ? [] : sourceBracketPairFragments(model.content)),
    [largeTextMode, model.content],
  );
  const blockComments = blockCommentTokens(filePath, kind);
  const largeSearchSignature = {
    caseSensitive,
    content: model.content,
    query: searchDraft,
    regexSearch,
    wholeWord,
  };
  const streamingSearchCountForQuery =
    streamingSearchCount?.query === searchDraft ? streamingSearchCount : null;
  const largeSearchRange =
    largeSearchResult &&
    sameLargeSearchSignature(largeSearchResult.signature, largeSearchSignature)
      ? largeSearchResult.range
      : null;
  const largeSearchNavigationForQuery =
    largeSearchNavigation &&
    sameLargeSearchSignature(largeSearchNavigation.signature, largeSearchSignature)
      ? largeSearchNavigation
      : null;
  const searchMatches = largeTextMode
    ? (streamingSearchCountForQuery?.count ?? 0)
    : countSearchMatches(model.content, searchDraft, {
        caseSensitive,
        wholeWord,
        regexSearch,
      });
  const activeMode =
    largeTextMode
      ? "source"
      : mode === "table" && (!json || !tableAvailable)
        ? "source"
        : mode === "tree" && !structured
          ? "source"
          : mode;

  useEffect(() => {
    saveJsonSchemaRegistry(schemaRegistry);
  }, [schemaRegistry]);

  useEffect(() => {
    return () => {
      searchCountCancelRef.current?.();
      searchRangeCancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    searchRangeCancelRef.current?.();
    searchRangeCancelRef.current = null;
  }, [
    caseSensitive,
    largeTextMode,
    model.content,
    regexSearch,
    searchDraft,
    wholeWord,
  ]);

  useEffect(() => {
    searchCountCancelRef.current?.();
    searchCountCancelRef.current = null;
    if (!largeTextMode || !searchDraft) return;
    searchCountCancelRef.current = startChunkedSearchCount({
      content: model.content,
      query: searchDraft,
      caseSensitive,
      wholeWord,
      regexSearch,
      onProgress: ({ count, processed, total }) =>
        setStreamingSearchCount({
          query: searchDraft,
          count,
          processed,
          total,
          complete: false,
        }),
      onDone: (count) =>
        setStreamingSearchCount({
          query: searchDraft,
          count,
          processed: model.content.length,
          total: model.content.length,
          complete: true,
        }),
    });
    return () => {
      searchCountCancelRef.current?.();
      searchCountCancelRef.current = null;
    };
  }, [
    caseSensitive,
    largeTextMode,
    model.content,
    regexSearch,
    searchDraft,
    wholeWord,
  ]);

  function togglePreviewMode() {
    setMode((current) => (current === "preview" ? "source" : "preview"));
  }

  function formatJson() {
    try {
      updateContent(`${JSON.stringify(JSON.parse(model.content), null, 2)}\n`);
    } catch {
      return;
    }
  }

  function minifyJson() {
    try {
      updateContent(JSON.stringify(JSON.parse(model.content)));
    } catch {
      return;
    }
  }

  function sortJsonKeys() {
    try {
      updateContent(`${JSON.stringify(sortJsonValue(JSON.parse(model.content)), null, 2)}\n`);
    } catch {
      return;
    }
  }

  function updateContent(
    content: string,
    options: { preserveSourceSelections?: boolean } = {},
  ) {
    if (largeTextMode) return;
    if (!options.preserveSourceSelections) clearSourceSelections();
    onChange({ ...model, content, trailingNewline: hasTrailingTextNewline(content) });
  }

  function syncLineNumberScroll() {
    if (!sourceRef.current || !lineNumberRef.current) return;
    lineNumberRef.current.scrollTop = sourceRef.current.scrollTop;
    setSourceScrollTop(sourceRef.current.scrollTop);
  }

  function updateCursor() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    if (activeFoldedSourceIds.size > 0) return;
    if (
      sourceSelectionRanges.length > 0 &&
      !sourceSelectionRanges.some(
        (range) =>
          range.start === textarea.selectionStart && range.end === textarea.selectionEnd,
      )
    ) {
      setSourceSelectionRanges([]);
    }
    setCursor({
      ...cursorPosition(model.content, textarea.selectionStart, textarea.selectionEnd),
      offset: textarea.selectionStart,
    });
  }

  function indentSelection() {
    withTextareaSelection((start, end) =>
      transformSelectedLines(model.content, start, end, indentTextLine),
    );
  }

  function outdentSelection() {
    withTextareaSelection((start, end) =>
      transformSelectedLines(model.content, start, end, outdentTextLine),
    );
  }

  function toggleLineComment() {
    const token = lineCommentToken(filePath, kind);
    withTextareaSelection((start, end) =>
      transformSelectedLines(model.content, start, end, (line) =>
        toggleCommentLine(line, token),
      ),
    );
  }

  function toggleBlockComment() {
    if (!blockComments) return;
    withTextareaSelection((start, end) =>
      toggleBlockCommentRange(model.content, start, end, blockComments),
    );
  }

  function duplicateSelection() {
    withTextareaSelection((start, end) => duplicateSelectedLines(model.content, start, end));
  }

  function moveSelection(direction: -1 | 1) {
    withTextareaSelection((start, end) =>
      moveSelectedLines(model.content, start, end, direction),
    );
  }

  function trimTrailingWhitespace() {
    updateContent(model.content.replace(/[ \t]+$/gm, ""));
  }

  function ensureFinalNewline() {
    if (model.content.endsWith("\n")) return;
    updateContent(`${model.content}\n`);
  }

  function toggleSourceFold(range: SourceFoldRange) {
    setFoldedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(range.id)) next.delete(range.id);
      else next.add(range.id);
      return next;
    });
  }

  function unfoldSourceLine(line: number) {
    setFoldedSourceIds((current) => {
      const hiddenRange = foldRanges.find(
        (range) => current.has(range.id) && line > range.startLine && line <= range.endLine,
      );
      if (!hiddenRange) return current;
      const next = new Set(current);
      next.delete(hiddenRange.id);
      return next;
    });
  }

  function selectSchema(schemaId: string) {
    setSelectedSchemaId(schemaId);
    const entry = schemaRegistry.find((candidate) => candidate.id === schemaId);
    if (!entry) {
      setSchemaDraft("");
      setSchemaNameDraft(schemaNameFromPath(filePath));
      return;
    }
    setSchemaDraft(entry.schema);
    setSchemaNameDraft(entry.name);
  }

  function startNewSchema() {
    setSelectedSchemaId("");
    setSchemaDraft("");
    setSchemaNameDraft(schemaNameFromPath(filePath));
  }

  function saveCurrentSchema() {
    if (!schemaDraft.trim() || schemaDraftError) return;
    if (selectedSchema) {
      const updated = updateJsonSchemaRegistryEntry(
        selectedSchema,
        schemaNameDraft,
        schemaDraft,
      );
      setSchemaRegistry((current) =>
        current
          .map((entry) => (entry.id === updated.id ? updated : entry))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
      setSchemaNameDraft(updated.name);
      return;
    }
    const created = createJsonSchemaRegistryEntry(schemaNameDraft, schemaDraft);
    setSchemaRegistry((current) => [created, ...current]);
    setSelectedSchemaId(created.id);
    setSchemaNameDraft(created.name);
  }

  function deleteSelectedSchema() {
    if (!selectedSchema) return;
    setSchemaRegistry((current) => current.filter((entry) => entry.id !== selectedSchema.id));
    startNewSchema();
  }

  function selectCurrentLine() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const range = selectedLineRange(model.content, textarea.selectionStart, textarea.selectionEnd);
    textarea.setSelectionRange(range.start, range.end);
    updateCursor();
  }

  function handleSourceKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (activeFoldedSourceIds.size > 0 && isPotentialSourceEditKey(event)) {
      event.preventDefault();
      setFoldedSourceIds(new Set());
      return;
    }
    const primary = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (handleSourceMultiCursorKey(event)) {
      return;
    }
    if (primary && key === "d") {
      event.preventDefault();
      addNextSourceSelection();
    } else if (event.altKey && event.shiftKey && key === "r") {
      event.preventDefault();
      activateRectangularSourceSelection();
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) outdentSelection();
      else indentSelection();
    } else if (primary && event.key === "/") {
      event.preventDefault();
      toggleLineComment();
    } else if (event.altKey && event.shiftKey && key === "a") {
      event.preventDefault();
      toggleBlockComment();
    } else if (primary && key === "[") {
      event.preventDefault();
      outdentSelection();
    } else if (primary && key === "]") {
      event.preventDefault();
      indentSelection();
    } else if (primary && key === "l") {
      event.preventDefault();
      selectCurrentLine();
    } else if (primary && !event.shiftKey && key === "f") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "h") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "g") {
      event.preventDefault();
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else if (event.altKey && event.shiftKey && event.key === "ArrowUp") {
      event.preventDefault();
      duplicateSelection();
    } else if (event.altKey && event.shiftKey && event.key === "ArrowDown") {
      event.preventDefault();
      duplicateSelection();
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (json && primary && event.shiftKey && key === "f") {
      event.preventDefault();
      formatJson();
    } else if (json && primary && event.shiftKey && key === "m") {
      event.preventDefault();
      minifyJson();
    } else if (json && primary && event.altKey && key === "k") {
      event.preventDefault();
      sortJsonKeys();
    } else if (json && primary && event.altKey && key === "s") {
      event.preventDefault();
      setSchemaOpen((current) => !current);
    } else if (structured && primary && event.shiftKey && key === "t") {
      event.preventDefault();
      setMode("tree");
    } else if (json && primary && event.shiftKey && key === "b") {
      event.preventDefault();
      setMode("table");
    } else if (primary && event.shiftKey && key === "v") {
      event.preventDefault();
      togglePreviewMode();
    } else if (autoPairSource(event, model.content, kind, applySourceEdit)) {
      event.preventDefault();
    }
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    const primary = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (primary && event.shiftKey && key === "v") {
      event.preventDefault();
      togglePreviewMode();
    } else if (structured && primary && event.shiftKey && key === "t") {
      event.preventDefault();
      setMode("tree");
    } else if (json && primary && event.shiftKey && key === "b") {
      event.preventDefault();
      setMode("table");
    }
  }

  function focusSourceRange(start: number, end: number) {
    setMode("source");
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const line = cursorPosition(model.content, start, end).line;
      textarea.scrollTop = Math.max(0, (line - 4) * 24);
      updateCursor();
      syncLineNumberScroll();
    });
  }

  function focusSourceLine(line: number) {
    unfoldSourceLine(line);
    const offset = offsetForTextLine(model.content, line);
    focusSourceRange(offset, offset);
  }

  function submitGoToLine() {
    const line = Math.max(1, Math.floor(Number(goToLineDraft)));
    if (!Number.isFinite(line)) return;
    focusSourceLine(line);
    setGoToLineOpen(false);
  }

  function findNext() {
    if (largeTextMode) {
      searchRangeCancelRef.current?.();
      searchRangeCancelRef.current = null;
      if (!searchDraft) return;
      setLargeSearchNavigation({
        processed: 0,
        total: model.content.length,
        signature: largeSearchSignature,
      });
      searchRangeCancelRef.current = startChunkedSearchRange({
        content: model.content,
        query: searchDraft,
        caseSensitive,
        wholeWord,
        regexSearch,
        start: largeSearchRange?.end ?? 0,
        onProgress: (progress) =>
          setLargeSearchNavigation({
            ...progress,
            signature: largeSearchSignature,
          }),
        onDone: (range) => {
          searchRangeCancelRef.current = null;
          setLargeSearchNavigation(null);
          setLargeSearchResult({ range, signature: largeSearchSignature });
        },
      });
      return;
    }
    const start = sourceRef.current?.selectionEnd ?? 0;
    const range = nextSearchRange(model.content, searchDraft, {
      caseSensitive,
      wholeWord,
      regexSearch,
      start,
    });
    if (range) focusSourceRange(range.start, range.end);
  }

  function replaceNext() {
    const textarea = sourceRef.current;
    const regex = buildSearchRegex(searchDraft, {
      caseSensitive,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const selected = model.content.slice(textarea.selectionStart, textarea.selectionEnd);
      regex.lastIndex = 0;
      const match = regex.exec(selected);
      if (match && match.index === 0 && match[0].length === selected.length) {
        const next = `${model.content.slice(0, textarea.selectionStart)}${selected.replace(regex, replaceDraft)}${model.content.slice(textarea.selectionEnd)}`;
        const caret = textarea.selectionStart + replaceDraft.length;
        updateContent(next);
        requestAnimationFrame(() => focusSourceRange(caret, caret));
        return;
      }
    }
    findNext();
  }

  function replaceAll() {
    const regex = buildSearchRegex(searchDraft, {
      caseSensitive,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    updateContent(model.content.replace(regex, replaceDraft));
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (commandId === "indent") {
      indentSelection();
    } else if (commandId === "outdent") {
      outdentSelection();
    } else if (commandId === "lineComment") {
      toggleLineComment();
    } else if (commandId === "blockComment") {
      toggleBlockComment();
    } else if (commandId === "selectLine") {
      selectCurrentLine();
    } else if (commandId === "goToLine") {
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else if (commandId === "togglePreview") {
      togglePreviewMode();
    } else if (commandId === "duplicateLine") {
      duplicateSelection();
    } else if (commandId === "moveLineUp") {
      moveSelection(-1);
    } else if (commandId === "moveLineDown") {
      moveSelection(1);
    } else if (commandId === "formatSource" && json) {
      formatJson();
    } else if (commandId === "minify" && json) {
      minifyJson();
    } else if (commandId === "sortKeys" && json) {
      sortJsonKeys();
    } else if (commandId === "schema" && json) {
      setSchemaOpen((current) => !current);
    } else if (commandId === "toggleTree" && structured) {
      setMode("tree");
    } else if (commandId === "toggleTable" && json && tableAvailable) {
      setMode("table");
    } else {
      return false;
    }
    return true;
    },
  );

  useEffect(() => {
    if (!commandRequest || handledCommandTokenRef.current === commandRequest.token) return;
    handledCommandTokenRef.current = commandRequest.token;
    window.setTimeout(() => {
      if (handleCommandRequest(commandRequest.id)) {
        onCommandHandled?.(commandRequest);
      }
    }, 0);
  }, [commandRequest, onCommandHandled]);

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={handleEditorKeyDown}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
            {language}
          </span>
          <button
            type="button"
            onClick={() => setSearchOpen((current) => !current)}
            className={toolbarTextButtonClass(searchOpen)}
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("documentEditor.find", { defaultValue: "Find" })}
          </button>
          <button
            type="button"
            onClick={() => {
              setGoToLineDraft(String(cursor.line));
              setGoToLineOpen((current) => !current);
            }}
            className={toolbarTextButtonClass(goToLineOpen)}
          >
            L:
            {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
          </button>
          <button type="button" onClick={indentSelection} className={toolbarIconButtonClass()}>
            <IndentIncrease className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={outdentSelection} className={toolbarIconButtonClass()}>
            <IndentDecrease className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={toggleLineComment} className={toolbarIconButtonClass()}>
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          {blockComments && (
            <button
              type="button"
              onClick={toggleBlockComment}
              className={toolbarTextButtonClass(false)}
              title="Toggle block comment"
            >
              /* */
            </button>
          )}
          <button type="button" onClick={duplicateSelection} className={toolbarIconButtonClass()}>
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => moveSelection(-1)} className={toolbarIconButtonClass()}>
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => moveSelection(1)} className={toolbarIconButtonClass()}>
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={trimTrailingWhitespace} className={toolbarIconButtonClass()}>
            <WrapText className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={ensureFinalNewline} className={toolbarIconButtonClass()}>
            <Pilcrow className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setOutlineOpen((current) => !current)}
            className={toolbarTextButtonClass(outlineOpen)}
          >
            <ListTree className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("documentEditor.outline", { defaultValue: "Outline" })}
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-faint)]">
            {model.encoding ?? "utf-8"}
          </span>
          <select
            value={lineEndingValue(model.lineEnding)}
            onChange={(event) =>
              onChange({ ...model, lineEnding: event.target.value })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text-muted)] outline-none hover:bg-[var(--surface-hover)] focus:border-[var(--accent)]"
            title="Line ending"
          >
            <option value={"\n"}>LF</option>
            <option value={"\r\n"}>CRLF</option>
            <option value={"\r"}>CR</option>
          </select>
          <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
            <input
              type="checkbox"
              checked={model.bom === true}
              onChange={(event) =>
                onChange({ ...model, bom: event.target.checked })
              }
            />
            BOM
          </label>
          {json && (
            <>
              <button
                type="button"
                onClick={formatJson}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >
                <Braces className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("documentEditor.format", { defaultValue: "Format" })}
              </button>
              <button
                type="button"
                onClick={minifyJson}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >
                <Rows3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Minify
              </button>
              <button
                type="button"
                onClick={sortJsonKeys}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >
                <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
                Sort keys
              </button>
              <button
                type="button"
                onClick={() => setSchemaOpen((current) => !current)}
                className={toolbarTextButtonClass(schemaOpen)}
              >
                <FileCog className="h-3.5 w-3.5" strokeWidth={1.75} />
                Schema
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setMode("source")}
            className={modeButtonClass(activeMode === "source")}
          >
            {t("documentEditor.source", { defaultValue: "Source" })}
          </button>
          {structured && (
            <button
              type="button"
              onClick={() => setMode("tree")}
              className={modeButtonClass(activeMode === "tree")}
            >
              {t("documentEditor.tree", { defaultValue: "Tree" })}
            </button>
          )}
          {json && (
            <button
              type="button"
              onClick={() => setMode("table")}
              disabled={!tableAvailable}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
              Table
            </button>
          )}
          <button
            type="button"
            onClick={togglePreviewMode}
            className={modeButtonClass(activeMode === "preview")}
          >
            {activeMode === "preview"
              ? t("documentEditor.source", { defaultValue: "Source" })
              : t("documentEditor.preview")}
          </button>
        </div>
      </div>
      {searchOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("documentEditor.find", { defaultValue: "Find" })}
            className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <input
            value={replaceDraft}
            onChange={(event) => setReplaceDraft(event.target.value)}
            placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
            className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button type="button" onClick={findNext} className={toolbarTextButtonClass(false)}>
            Next
          </button>
          <button
            type="button"
            onClick={replaceNext}
            disabled={largeTextMode}
            className={toolbarTextButtonClass(false)}
          >
            Replace
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={largeTextMode}
            className={toolbarTextButtonClass(false)}
          >
            All
          </button>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
            />
            Aa
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(event) => setWholeWord(event.target.checked)}
            />
            Word
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={regexSearch}
              onChange={(event) => setRegexSearch(event.target.checked)}
            />
            .*
          </label>
          <span className="text-xs text-[var(--text-faint)]">{searchMatches} matches</span>
          {largeTextMode && streamingSearchCountForQuery && !streamingSearchCountForQuery.complete && (
            <span className="text-xs text-[var(--text-faint)]">
              scanning {Math.round((streamingSearchCountForQuery.processed / Math.max(1, streamingSearchCountForQuery.total)) * 100)}%
            </span>
          )}
          {largeTextMode && largeSearchNavigationForQuery && (
            <span className="text-xs text-[var(--text-faint)]">
              locating {Math.round((largeSearchNavigationForQuery.processed / Math.max(1, largeSearchNavigationForQuery.total)) * 100)}%
            </span>
          )}
        </div>
      )}
      {goToLineOpen && (
        <form
          className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitGoToLine();
          }}
        >
          <span className="text-xs text-[var(--text-muted)]">
            {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
          </span>
          <input
            value={goToLineDraft}
            onChange={(event) => setGoToLineDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setGoToLineOpen(false);
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
      )}
      {json && schemaOpen && (
        <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 lg:grid-cols-[220px_minmax(0,1fr)_minmax(180px,260px)]">
          <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
            <select
              value={selectedSchemaId}
              onChange={(event) => selectSchema(event.target.value)}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="">Unsaved schema</option>
              {schemaRegistry.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <input
              value={schemaNameDraft}
              onChange={(event) => setSchemaNameDraft(event.target.value)}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              placeholder="Schema name"
            />
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={startNewSchema}
                className={toolbarTextButtonClass(false)}
              >
                <FilePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                New
              </button>
              <button
                type="button"
                onClick={saveCurrentSchema}
                disabled={!schemaDraft.trim() || Boolean(schemaDraftError)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                Save
              </button>
              <button
                type="button"
                onClick={deleteSelectedSchema}
                disabled={!selectedSchema}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Delete
              </button>
            </div>
          </div>
          <textarea
            value={schemaDraft}
            onChange={(event) => setSchemaDraft(event.target.value)}
            placeholder="JSON Schema"
            spellCheck={false}
            className="h-24 min-h-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs text-[var(--text-muted)]">
            <div className="font-medium text-[var(--text)]">JSON Schema</div>
            <div className="mt-1 text-[var(--text-faint)]">
              type, required, properties, items, enum
            </div>
            {schemaDraftError ? (
              <div className="mt-2 text-[var(--status-error)]">{schemaDraftError}</div>
            ) : schemaDraft.trim() ? (
              <div className="mt-2 text-[var(--text-faint)]">
                {schemaDiagnostics.length} schema issues
              </div>
            ) : (
              <div className="mt-2 text-[var(--text-faint)]">
                {schemaRegistry.length} saved schemas
              </div>
            )}
            {selectedSchema && (
              <div className="mt-2 text-[var(--text-faint)]">
                Updated {new Date(selectedSchema.updatedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}
      {largeTextMode && (
        <div className="shrink-0 border-b border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
          Large file mode: source is read-only and rendered with a virtualized line window.
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="shrink-0 border-b border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
          {diagnostics.map((diagnostic) => (
            <button
              key={`${diagnostic.line}:${diagnostic.path}:${diagnostic.message}`}
              type="button"
              onClick={() => {
                if (diagnostic.line) focusSourceLine(diagnostic.line);
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
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {activeMode === "table" && json ? (
            <JsonTableEditor
              content={model.content}
              onChangeContent={updateContent}
            />
          ) : activeMode === "tree" && json ? (
            <StructuredJsonEditor
              content={model.content}
              onChangeContent={updateContent}
            />
          ) : activeMode === "tree" && (kind === "yaml" || kind === "toml") ? (
            <FlatConfigEditor
              kind={kind}
              content={model.content}
              onChangeContent={updateContent}
            />
          ) : activeMode === "preview" && json ? (
            <JsonPreview content={model.content} />
          ) : activeMode === "preview" && (kind === "yaml" || kind === "toml") ? (
            <ConfigPreview kind={kind} content={model.content} />
          ) : activeMode === "preview" ? (
            <div
              className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4"
              tabIndex={0}
            >
              <HighlightedCodeBlock code={model.content} language={language} />
            </div>
          ) : largeTextMode ? (
            <LargeTextSourceViewer
              content={model.content}
              lineCount={lineCount}
              searchRange={largeSearchRange}
            />
          ) : (
            <TextSourcePane
              sourceRef={sourceRef}
              lineNumberRef={lineNumberRef}
              sourceDisplayContent={sourceDisplayContent}
              visibleSourceLines={visibleSourceLines}
              foldRangeByStart={foldRangeByStart}
              activeFoldedSourceIds={activeFoldedSourceIds}
              diagnosticsByLine={diagnosticsByLine}
              minimapLines={minimapLines}
              cursorLine={cursor.line}
              sourceScrollTop={sourceScrollTop}
              selectionFragments={sourceSelectionFragments}
              bracketFragments={bracketPairFragments}
              onContentChange={updateContent}
              onKeyDown={handleSourceKeyDown}
              onPaste={handleSourcePaste}
              onCursorUpdate={updateCursor}
              onScroll={syncLineNumberScroll}
              onFocusLine={focusSourceLine}
              onToggleFold={toggleSourceFold}
            />
          )}
        </div>
        {outlineOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
              <span className="text-xs font-semibold text-[var(--text)]">
                {t("documentEditor.outline", { defaultValue: "Outline" })}
              </span>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
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
                      onClick={() => focusSourceLine(item.line)}
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
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
        <span>
          L{cursor.line}:C{cursor.column}
          {cursor.selection > 0 ? ` · ${cursor.selection} selected` : ""}
          {sourceSelectionRanges.length > 1
            ? ` · ${sourceSelectionRanges.length} cursors`
            : ""}
          {largeTextMode ? " · read-only" : ""}
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
          {stats.lines} lines · {stats.characters} chars · {lineEndingLabel(model.lineEnding)}
        </span>
      </div>
    </div>
  );
}

function toolbarIconButtonClass() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";
}

function toolbarTextButtonClass(active: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
    active && "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]",
  );
}

function modeButtonClass(active: boolean) {
  return cn(
    "rounded-md border px-2 py-1 text-xs",
    active
      ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
      : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
  );
}

function sameLargeSearchSignature(
  left: LargeSearchSignature,
  right: LargeSearchSignature,
) {
  return (
    left.content === right.content &&
    left.query === right.query &&
    left.caseSensitive === right.caseSensitive &&
    left.wholeWord === right.wholeWord &&
    left.regexSearch === right.regexSearch
  );
}
