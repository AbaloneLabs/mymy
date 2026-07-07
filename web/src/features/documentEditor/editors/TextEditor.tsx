import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Braces,
  Copy,
  FileCog,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  MessageSquare,
  Minus,
  Pilcrow,
  Plus,
  Rows3,
  Search,
  Table,
  WrapText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/chat/codeHighlight";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import { isRecord } from "../models";
import type { TextModel } from "../models";
import {
  autoPairSource,
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
  textEditorKind,
  textSourceOutline,
  textStats,
  toggleBlockCommentRange,
  toggleCommentLine,
  transformSelectedLines,
} from "../textSourceUtils";
import type { SourceEdit } from "../textSourceUtils";
import {
  appendFlatConfigEntry,
  configEntryParentLabel,
  configEntryPathLabel,
  configScalarType,
  flatConfigLine,
  jsonSchemaDiagnostics,
  parseFlatConfig,
  sourceDiagnostics,
} from "../textStructuredUtils";
import type { ConfigEntry } from "../textStructuredUtils";
import {
  cloneJsonValue,
  coerceJsonEditorValue,
  deleteJsonPathValue,
  firstJsonChildPathSegment,
  getJsonPathValue,
  insertJsonObjectEntry,
  isTabularJson,
  jsonCellToString,
  jsonEditorValueType,
  jsonPathExists,
  jsonPathLabel,
  jsonPathsEqual,
  jsonPrimitiveClass,
  nextJsonColumnKey,
  nextJsonObjectKey,
  nextJsonTableObjectKey,
  parentJsonPath,
  parseJsonCell,
  parseJsonContent,
  setJsonPathValue,
  sortJsonValue,
  tabularJsonModel,
} from "../textJsonUtils";
import type { JsonPathSegment, JsonTableRow } from "../textJsonUtils";

type TextEditorMode = "source" | "tree" | "table" | "preview";

const LARGE_TEXT_FILE_CHAR_LIMIT = 1_000_000;
const LARGE_TEXT_FILE_LINE_LIMIT = 50_000;
const LARGE_TEXT_LINE_HEIGHT = 24;
const LARGE_TEXT_OVERSCAN_LINES = 24;

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
  const lineNumberRef = useRef<HTMLPreElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [mode, setMode] = useState<TextEditorMode>("source");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineDraft, setGoToLineDraft] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selection: 0 });
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
  const diagnostics = largeTextMode
    ? []
    : [
        ...sourceDiagnostics(model.content, kind),
        ...jsonSchemaDiagnostics(parsedJson, schemaDraft, json),
      ];
  const outline = largeTextMode ? [] : textSourceOutline(model.content, language);
  const stats = textStats(model.content);
  const blockComments = blockCommentTokens(filePath, kind);
  const searchMatches = countSearchMatches(model.content, searchDraft, {
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

  function updateContent(content: string) {
    if (largeTextMode) return;
    onChange({ ...model, content, trailingNewline: hasTrailingTextNewline(content) });
  }

  function syncLineNumberScroll() {
    if (!sourceRef.current || !lineNumberRef.current) return;
    lineNumberRef.current.scrollTop = sourceRef.current.scrollTop;
  }

  function updateCursor() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    setCursor(cursorPosition(model.content, textarea.selectionStart, textarea.selectionEnd));
  }

  function applySourceEdit(
    edit: SourceEdit | null,
    fallbackSelection?: { start: number; end: number },
  ) {
    if (!edit) return;
    updateContent(edit.content);
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(
        fallbackSelection?.start ?? edit.selectionStart,
        fallbackSelection?.end ?? edit.selectionEnd,
      );
      updateCursor();
      syncLineNumberScroll();
    });
  }

  function withTextareaSelection(
    operation: (start: number, end: number) => SourceEdit | null,
  ) {
    const textarea = sourceRef.current;
    if (!textarea) return;
    applySourceEdit(operation(textarea.selectionStart, textarea.selectionEnd));
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

  function selectCurrentLine() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const range = selectedLineRange(model.content, textarea.selectionStart, textarea.selectionEnd);
    textarea.setSelectionRange(range.start, range.end);
    updateCursor();
  }

  function handleSourceKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const primary = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === "Tab") {
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
          <button type="button" onClick={replaceNext} className={toolbarTextButtonClass(false)}>
            Replace
          </button>
          <button type="button" onClick={replaceAll} className={toolbarTextButtonClass(false)}>
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
        <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)]">
          <textarea
            value={schemaDraft}
            onChange={(event) => setSchemaDraft(event.target.value)}
            placeholder='{"type":"object","required":[],"properties":{}}'
            spellCheck={false}
            className="h-24 min-h-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs text-[var(--text-muted)]">
            <div className="font-medium text-[var(--text)]">JSON Schema</div>
            <div className="mt-1 text-[var(--text-faint)]">
              type, required, properties, items, enum
            </div>
            {schemaDraft.trim() ? (
              <div className="mt-2 text-[var(--text-faint)]">
                {jsonSchemaDiagnostics(parsedJson, schemaDraft, json).length} schema issues
              </div>
            ) : (
              <div className="mt-2 text-[var(--text-faint)]">No schema selected</div>
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
            <div key={`${diagnostic.line}:${diagnostic.path}:${diagnostic.message}`}>
              {diagnostic.line ? `L${diagnostic.line}: ` : ""}
              {diagnostic.path ? `${diagnostic.path}: ` : ""}
              {diagnostic.message}
            </div>
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
            <LargeTextSourceViewer content={model.content} lineCount={lineCount} />
          ) : (
            <div className="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--bg)]">
              <pre
                ref={lineNumberRef}
                className="select-none overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] px-3 py-4 text-right font-mono text-xs leading-6 text-[var(--text-faint)]"
              >
                {Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}
              </pre>
              <textarea
                ref={sourceRef}
                value={model.content}
                onChange={(event) => updateContent(event.target.value)}
                onKeyDown={handleSourceKeyDown}
                onSelect={updateCursor}
                onKeyUp={updateCursor}
                onClick={updateCursor}
                onScroll={syncLineNumberScroll}
                spellCheck={false}
                className="min-h-0 resize-none bg-[var(--bg)] p-4 font-mono text-sm leading-6 text-[var(--text)] outline-none"
              />
            </div>
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
          {largeTextMode ? " · read-only" : ""}
        </span>
        <span>
          {stats.lines} lines · {stats.characters} chars · {lineEndingLabel(model.lineEnding)}
        </span>
      </div>
    </div>
  );
}

function FlatConfigEditor({
  kind,
  content,
  onChangeContent,
}: {
  kind: "yaml" | "toml";
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newSection, setNewSection] = useState("");
  const parsed = parseFlatConfig(content, kind);

  function updateLine(entry: ConfigEntry, key: string, value: string) {
    const cleanKey = key.trim();
    if (entry.keyEditable && !cleanKey) return;
    const lines = content.split("\n");
    lines[entry.lineIndex] = flatConfigLine(entry, cleanKey, value, kind);
    onChangeContent(lines.join("\n"));
  }

  function deleteLine(lineIndex: number) {
    const lines = content.split("\n");
    lines.splice(lineIndex, 1);
    onChangeContent(lines.join("\n"));
  }

  function duplicateLine(lineIndex: number) {
    const lines = content.split("\n");
    lines.splice(lineIndex + 1, 0, lines[lineIndex] ?? "");
    onChangeContent(lines.join("\n"));
  }

  function moveLine(lineIndex: number, direction: -1 | 1) {
    const lines = content.split("\n");
    const nextIndex = lineIndex + direction;
    if (nextIndex < 0 || nextIndex >= lines.length) return;
    const [line] = lines.splice(lineIndex, 1);
    lines.splice(nextIndex, 0, line);
    onChangeContent(lines.join("\n"));
  }

  function addEntry() {
    const cleanKey = newKey.trim();
    if (!cleanKey) return;
    onChangeContent(
      appendFlatConfigEntry(content, {
        key: cleanKey,
        kind,
        section: newSection.trim(),
        value: newValue,
      }),
    );
    setNewKey("");
    setNewValue("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {kind === "toml" && (
          <input
            value={newSection}
            onChange={(event) => setNewSection(event.target.value)}
            placeholder="section"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        {kind === "yaml" && (
          <input
            value={newSection}
            onChange={(event) => setNewSection(event.target.value)}
            placeholder="parent.path"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <input
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
          placeholder={t("common.name")}
          className="h-8 min-w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          placeholder={t("documentEditor.value", { defaultValue: "Value" })}
          className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!newKey.trim()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("common.add")}
        </button>
        {parsed.unsupportedCount > 0 && (
          <span className="text-xs text-[var(--text-faint)]">
            {parsed.unsupportedCount} preserved source lines
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {parsed.entries.map((entry) => (
            <div
              key={`${entry.lineIndex}:${entry.key}`}
              className="grid gap-2 md:grid-cols-[minmax(120px,220px)_minmax(120px,220px)_minmax(0,1fr)_auto]"
            >
              <span
                className="min-w-0 truncate rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-faint)]"
                title={configEntryPathLabel(entry)}
              >
                {configEntryParentLabel(entry)}
              </span>
              <input
                value={entry.key}
                onChange={(event) => updateLine(entry, event.target.value, entry.value)}
                disabled={!entry.keyEditable}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)] disabled:text-[var(--text-faint)]"
              />
              <input
                value={entry.value}
                onChange={(event) => updateLine(entry, entry.key, event.target.value)}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <div className="flex items-center gap-1">
                <JsonIconButton
                  disabled={entry.lineIndex <= 0}
                  icon={ArrowUp}
                  label="Move entry up"
                  onClick={() => moveLine(entry.lineIndex, -1)}
                />
                <JsonIconButton
                  disabled={entry.lineIndex >= content.split("\n").length - 1}
                  icon={ArrowDown}
                  label="Move entry down"
                  onClick={() => moveLine(entry.lineIndex, 1)}
                />
                <JsonIconButton
                  icon={Copy}
                  label="Duplicate entry"
                  onClick={() => duplicateLine(entry.lineIndex)}
                />
                <JsonDeleteButton onClick={() => deleteLine(entry.lineIndex)} />
              </div>
            </div>
          ))}
          {parsed.entries.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              No editable top-level key/value pairs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigPreview({
  kind,
  content,
}: {
  kind: "yaml" | "toml";
  content: string;
}) {
  const parsed = parseFlatConfig(content, kind);
  const rows = parsed.entries.map((entry) => ({
    path: configEntryPathLabel(entry),
    key: entry.key,
    type: configScalarType(entry.value),
    value: entry.value,
  }));

  return (
    <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4" tabIndex={0}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono uppercase">
          {kind}
        </span>
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
          No previewable key/value entries.
        </div>
      ) : (
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)]">
              <th className="sticky top-0 z-10 w-[38%] bg-[var(--surface)] px-3 py-2 font-medium">
                Path
              </th>
              <th className="sticky top-0 z-10 w-[18%] bg-[var(--surface)] px-3 py-2 font-medium">
                Key
              </th>
              <th className="sticky top-0 z-10 w-[12%] bg-[var(--surface)] px-3 py-2 font-medium">
                Type
              </th>
              <th className="sticky top-0 z-10 bg-[var(--surface)] px-3 py-2 font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`${rowIndex}:${row.path}`}
                className="border-b border-[var(--border)]/70 hover:bg-[var(--surface-hover)]"
              >
                <td className="max-w-0 px-3 py-2 align-top">
                  <code
                    className="block truncate font-mono text-[11px] text-[var(--text-muted)]"
                    title={row.path}
                  >
                    {row.path}
                  </code>
                </td>
                <td className="max-w-0 px-3 py-2 align-top">
                  <span className="block truncate font-mono text-[11px] font-medium text-[var(--accent)]">
                    {row.key}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className={jsonPreviewTypeClass(row.type)}>{row.type}</span>
                </td>
                <td className="max-w-0 px-3 py-2 align-top">
                  <span
                    className={cn(
                      "block truncate font-mono text-[11px]",
                      row.value ? "text-[var(--text)]" : "text-[var(--text-faint)]",
                    )}
                    title={row.value}
                  >
                    {row.value || "(empty)"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LargeTextSourceViewer({
  content,
  lineCount,
}: {
  content: string;
  lineCount: number;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const lines = useMemo(() => content.split("\n"), [content]);
  const visibleLineCount = Math.ceil(viewport.height / LARGE_TEXT_LINE_HEIGHT);
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / LARGE_TEXT_LINE_HEIGHT) - LARGE_TEXT_OVERSCAN_LINES,
  );
  const end = Math.min(
    lines.length,
    start + visibleLineCount + LARGE_TEXT_OVERSCAN_LINES * 2,
  );
  const top = start * LARGE_TEXT_LINE_HEIGHT;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport({ height: element.clientHeight, scrollTop: element.scrollTop });
  }, []);

  return (
    <div
      ref={viewportRef}
      onScroll={(event) =>
        setViewport({
          height: event.currentTarget.clientHeight,
          scrollTop: event.currentTarget.scrollTop,
        })
      }
      className="h-full min-h-0 overflow-auto bg-[var(--bg)] font-mono text-sm text-[var(--text)]"
    >
      <div
        className="relative min-w-max"
        style={{ height: Math.max(1, lineCount) * LARGE_TEXT_LINE_HEIGHT }}
      >
        <div
          className="absolute left-0 right-0 grid grid-cols-[auto_minmax(0,1fr)]"
          style={{ transform: `translateY(${top}px)` }}
        >
          {lines.slice(start, end).map((line, offset) => {
            const lineNumber = start + offset + 1;
            return (
              <div key={lineNumber} className="contents">
                <div
                  className="select-none border-r border-[var(--border)] bg-[var(--surface)] px-3 text-right text-xs leading-6 text-[var(--text-faint)]"
                  style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                >
                  {lineNumber}
                </div>
                <pre
                  className="m-0 whitespace-pre px-4 text-sm leading-6"
                  style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                >
                  {line || " "}
                </pre>
              </div>
            );
          })}
        </div>
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

function StructuredJsonEditor({
  content,
  onChangeContent,
}: {
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<JsonPathSegment[]>([]);
  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(content || "null") };
    } catch {
      return { ok: false };
    }
  }, [content]);

  if (!parsed.ok) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="mb-3 rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.invalidJson")}
        </div>
        <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
          {content}
        </pre>
      </div>
    );
  }

  const rootValue = parsed.value;
  const currentPath = jsonPathExists(rootValue, selectedPath)
    ? selectedPath
    : parentJsonPath(selectedPath);

  function updateValue(next: unknown) {
    onChangeContent(`${JSON.stringify(next, null, 2)}\n`);
  }

  function updateSelected(next: unknown) {
    updateValue(setJsonPathValue(rootValue, currentPath, next));
  }

  function addChild() {
    const selected = getJsonPathValue(rootValue, currentPath);
    if (Array.isArray(selected)) {
      const nextPath = [...currentPath, selected.length];
      updateSelected([...selected, ""]);
      setSelectedPath(nextPath);
      return;
    }
    if (isRecord(selected)) {
      const key = nextJsonObjectKey(selected);
      updateSelected({ ...selected, [key]: "" });
      setSelectedPath([...currentPath, key]);
    }
  }

  function addSibling() {
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    if (Array.isArray(parent) && typeof key === "number") {
      const next = [...parent];
      next.splice(key + 1, 0, "");
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, key + 1]);
      return;
    }
    if (isRecord(parent)) {
      const nextKey = nextJsonObjectKey(parent);
      const next = insertJsonObjectEntry(parent, String(key), nextKey, "");
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextKey]);
    }
  }

  function duplicateSelected() {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    const selected = getJsonPathValue(rootValue, currentPath);
    if (Array.isArray(parent) && typeof key === "number") {
      const next = [...parent];
      next.splice(key + 1, 0, cloneJsonValue(selected));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, key + 1]);
      return;
    }
    if (isRecord(parent)) {
      const nextKey = nextJsonObjectKey(parent, `${String(key)}Copy`);
      const next = insertJsonObjectEntry(parent, String(key), nextKey, cloneJsonValue(selected));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextKey]);
    }
  }

  function deleteSelected() {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    updateValue(deleteJsonPathValue(rootValue, currentPath));
    setSelectedPath(parentPath);
  }

  function moveSelected(direction: -1 | 1) {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    if (Array.isArray(parent) && typeof key === "number") {
      const nextIndex = key + direction;
      if (nextIndex < 0 || nextIndex >= parent.length) return;
      const next = [...parent];
      const [moved] = next.splice(key, 1);
      next.splice(nextIndex, 0, moved);
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextIndex]);
      return;
    }
    if (isRecord(parent)) {
      const keys = Object.keys(parent);
      const index = keys.indexOf(String(key));
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= keys.length) return;
      const nextKeys = [...keys];
      const [moved] = nextKeys.splice(index, 1);
      nextKeys.splice(nextIndex, 0, moved);
      const next = Object.fromEntries(nextKeys.map((itemKey) => [itemKey, parent[itemKey]]));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
    }
  }

  function sortSelectedKeys() {
    const selected = getJsonPathValue(rootValue, currentPath);
    if (!isRecord(selected)) return;
    updateSelected(sortJsonValue(selected));
  }

  function selectParent() {
    setSelectedPath(parentJsonPath(currentPath));
  }

  function selectFirstChild() {
    const selected = getJsonPathValue(rootValue, currentPath);
    const child = firstJsonChildPathSegment(selected);
    if (child !== null) setSelectedPath([...currentPath, child]);
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const primary = event.ctrlKey || event.metaKey;
    if (event.key === "Insert") {
      event.preventDefault();
      addSibling();
    } else if (primary && event.key === "Enter") {
      event.preventDefault();
      addChild();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveSelected(-1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveSelected(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectParent();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectFirstChild();
    }
  }

  const selectedValue = getJsonPathValue(rootValue, currentPath);
  const selectedType = jsonEditorValueType(selectedValue);
  const canAddChild = Array.isArray(selectedValue) || isRecord(selectedValue);
  const canSortKeys = isRecord(selectedValue);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <JsonBreadcrumb path={currentPath} onSelect={setSelectedPath} />
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={addSibling}
            disabled={currentPath.length === 0}
            className={toolbarTextButtonClass(false)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Sibling
          </button>
          <button
            type="button"
            onClick={addChild}
            disabled={!canAddChild}
            className={toolbarTextButtonClass(false)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Child
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            disabled={currentPath.length === 0}
            className={toolbarTextButtonClass(false)}
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={sortSelectedKeys}
            disabled={!canSortKeys}
            className={toolbarTextButtonClass(false)}
          >
            <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
            Sort
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={currentPath.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <JsonEditableValue
            value={rootValue}
            path={[]}
            selectedPath={currentPath}
            onSelect={setSelectedPath}
            onChange={updateValue}
          />
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)]">
            Inspector
          </div>
          <div className="space-y-3 p-3 text-xs text-[var(--text-muted)]">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Path
              </div>
              <code className="block break-all rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text)]">
                {jsonPathLabel(currentPath)}
              </code>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Type
              </span>
              <select
                value={selectedType}
                onChange={(event) =>
                  updateSelected(coerceJsonEditorValue(selectedValue, event.target.value))
                }
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="object">object</option>
                <option value="array">array</option>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="null">null</option>
              </select>
            </label>
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] leading-5 text-[var(--text-faint)]">
              Insert adds a sibling. Ctrl/Cmd+Enter adds a child. Alt+Up/Down
              reorders the selected node.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function JsonTableEditor({
  content,
  onChangeContent,
}: {
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const parsed = parseJsonContent(content);
  const table = tabularJsonModel(parsed);
  if (!table) {
    return (
      <div className="h-full overflow-auto p-4 text-sm text-[var(--text-muted)]">
        JSON table mode requires a root array of objects or an object whose
        values are objects.
      </div>
    );
  }
  const tableModel = table;
  const { rows, columns } = tableModel;

  function updateRows(nextRows: JsonTableRow[]) {
    if (tableModel.kind === "array") {
      onChangeContent(`${JSON.stringify(nextRows.map((row) => row.value), null, 2)}\n`);
      return;
    }
    onChangeContent(
      `${JSON.stringify(
        Object.fromEntries(
          nextRows
            .filter((row) => row.key?.trim())
            .map((row) => [row.key?.trim() ?? "", row.value]),
        ),
        null,
        2,
      )}\n`,
    );
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex
          ? {
              ...row,
              value: {
                ...row.value,
                [key]: parseJsonCell(value, row.value[key]),
              },
            }
          : row,
      ),
    );
  }

  function renameRowKey(rowIndex: number, nextKey: string) {
    const cleanKey = nextKey.trim();
    if (tableModel.kind !== "object" || !cleanKey) return;
    if (rows.some((row, index) => index !== rowIndex && row.key === cleanKey)) return;
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex ? { ...row, key: cleanKey } : row,
      ),
    );
  }

  function renameColumn(currentKey: string, nextKey: string) {
    if (!nextKey.trim() || currentKey === nextKey) return;
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row.value)) {
          next[key === currentKey ? nextKey : key] = value;
        }
        if (!(currentKey in row.value)) next[nextKey] = "";
        return { ...row, value: next };
      }),
    );
  }

  function addColumn() {
    const nextKey = nextJsonColumnKey(columns);
    updateRows(rows.map((row) => ({ ...row, value: { ...row.value, [nextKey]: "" } })));
  }

  function duplicateColumn(key: string) {
    const nextKey = nextJsonColumnKey(columns);
    updateRows(
      rows.map((row) => ({
        ...row,
        value: { ...row.value, [nextKey]: cloneJsonValue(row.value[key]) },
      })),
    );
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const index = columns.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(index, 1);
    nextColumns.splice(nextIndex, 0, moved);
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        nextColumns.forEach((column) => {
          next[column] = row.value[column];
        });
        return { ...row, value: next };
      }),
    );
  }

  function deleteColumn(key: string) {
    updateRows(
      rows.map((row) => {
        const next = { ...row.value };
        delete next[key];
        return { ...row, value: next };
      }),
    );
  }

  function addRow() {
    const emptyValue = Object.fromEntries(columns.map((column) => [column, ""]));
    updateRows([
      ...rows,
      {
        key: tableModel.kind === "object" ? nextJsonTableObjectKey(rows) : undefined,
        value: emptyValue,
      },
    ]);
  }

  function duplicateRow(index: number) {
    updateRows([
      ...rows.slice(0, index + 1),
      {
        key:
          tableModel.kind === "object"
            ? nextJsonTableObjectKey(rows, `${rows[index]?.key ?? "row"}Copy`)
            : undefined,
        value: cloneJsonValue(rows[index]?.value ?? {}) as Record<string, unknown>,
      },
      ...rows.slice(index + 1),
    ]);
  }

  function moveRow(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    const nextRows = [...rows];
    const [moved] = nextRows.splice(index, 1);
    nextRows.splice(nextIndex, 0, moved);
    updateRows(nextRows);
  }

  function deleteRow(index: number) {
    updateRows(rows.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add row
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add column
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-collapse text-xs shadow-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-12 border border-[var(--border)] bg-[var(--surface)]" />
              {tableModel.kind === "object" && (
                <th className="sticky top-0 z-10 min-w-36 border border-[var(--border)] bg-[var(--surface)] p-1 font-mono text-[var(--text-muted)]">
                  key
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column}
                  className="sticky top-0 z-10 min-w-40 border border-[var(--border)] bg-[var(--surface)] p-1"
                >
                  <div className="flex items-center gap-1">
                    <input
                      value={column}
                      onChange={(event) => renameColumn(column, event.target.value)}
                      className="min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none"
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === 0}
                      icon={ArrowLeft}
                      label="Move column left"
                      onClick={() => moveColumn(column, -1)}
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === columns.length - 1}
                      icon={ArrowRight}
                      label="Move column right"
                      onClick={() => moveColumn(column, 1)}
                    />
                    <JsonIconButton
                      icon={Copy}
                      label="Duplicate column"
                      onClick={() => duplicateColumn(column)}
                    />
                    <JsonDeleteButton onClick={() => deleteColumn(column)} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)]">
                  <div className="flex items-center gap-1">
                    <span className="min-w-6 text-right">{rowIndex + 1}</span>
                    <JsonIconButton
                      disabled={rowIndex === 0}
                      icon={ArrowUp}
                      label="Move row up"
                      onClick={() => moveRow(rowIndex, -1)}
                    />
                    <JsonIconButton
                      disabled={rowIndex === rows.length - 1}
                      icon={ArrowDown}
                      label="Move row down"
                      onClick={() => moveRow(rowIndex, 1)}
                    />
                    <JsonIconButton
                      icon={Copy}
                      label="Duplicate row"
                      onClick={() => duplicateRow(rowIndex)}
                    />
                    <JsonDeleteButton onClick={() => deleteRow(rowIndex)} />
                  </div>
                </th>
                {tableModel.kind === "object" && (
                  <td className="border border-[var(--border)] p-0">
                    <input
                      value={row.key ?? ""}
                      onChange={(event) => renameRowKey(rowIndex, event.target.value)}
                      className="h-8 min-w-36 bg-[var(--bg)] px-2 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column} className="border border-[var(--border)] p-0">
                    <input
                      value={jsonCellToString(row.value[column])}
                      onChange={(event) =>
                        updateCell(rowIndex, column, event.target.value)
                      }
                      className="h-8 min-w-40 bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length + (tableModel.kind === "object" ? 2 : 1))}
                  className="border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]"
                >
                  Empty table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface JsonPreviewRow {
  path: string;
  key: string;
  type: string;
  value: string;
  depth: number;
  summary: string;
}

function JsonPreview({ content }: { content: string }) {
  const { t } = useTranslation();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || "null");
  } catch {
    return (
      <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4">
        <div className="mb-3 rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.invalidJson")}
        </div>
        <HighlightedCodeBlock code={content} language="json" />
      </div>
    );
  }

  const rows = flattenJsonPreviewRows(parsed);
  const rootType = jsonPreviewType(parsed);

  return (
    <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4" tabIndex={0}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono">
          {rootType}
        </span>
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)]">
            <th className="sticky top-0 z-10 w-[34%] bg-[var(--surface)] px-3 py-2 font-medium">
              Path
            </th>
            <th className="sticky top-0 z-10 w-[18%] bg-[var(--surface)] px-3 py-2 font-medium">
              Key
            </th>
            <th className="sticky top-0 z-10 w-[12%] bg-[var(--surface)] px-3 py-2 font-medium">
              Type
            </th>
            <th className="sticky top-0 z-10 bg-[var(--surface)] px-3 py-2 font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${rowIndex}:${row.path}`}
              className="border-b border-[var(--border)]/70 hover:bg-[var(--surface-hover)]"
            >
              <td className="max-w-0 px-3 py-2 align-top">
                <code
                  className="block truncate font-mono text-[11px] text-[var(--text-muted)]"
                  title={row.path}
                  style={{ paddingLeft: `${Math.min(row.depth, 8) * 10}px` }}
                >
                  {row.path}
                </code>
              </td>
              <td className="max-w-0 px-3 py-2 align-top">
                <span className="block truncate font-mono text-[11px] font-medium text-[var(--accent)]">
                  {row.key}
                </span>
              </td>
              <td className="px-3 py-2 align-top">
                <span className={jsonPreviewTypeClass(row.type)}>{row.type}</span>
              </td>
              <td className="max-w-0 px-3 py-2 align-top">
                <span
                  className={cn(
                    "block truncate font-mono text-[11px]",
                    row.value ? "text-[var(--text)]" : "text-[var(--text-faint)]",
                  )}
                  title={row.value || row.summary}
                >
                  {row.value || row.summary}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function flattenJsonPreviewRows(value: unknown) {
  const rows: JsonPreviewRow[] = [];
  visitJsonPreviewValue(value, "$", "root", 0, rows);
  return rows;
}

function visitJsonPreviewValue(
  value: unknown,
  path: string,
  key: string,
  depth: number,
  rows: JsonPreviewRow[],
) {
  const type = jsonPreviewType(value);
  rows.push({
    path,
    key,
    type,
    value: jsonPreviewPrimitiveValue(value),
    depth,
    summary: jsonPreviewSummary(value),
  });
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitJsonPreviewValue(item, `${path}[${index}]`, `[${index}]`, depth + 1, rows),
    );
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([entryKey, item]) =>
      visitJsonPreviewValue(
        item,
        `${path}.${entryKey}`,
        entryKey,
        depth + 1,
        rows,
      ),
    );
  }
}

function jsonPreviewType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (value === null) return "null";
  return typeof value;
}

function jsonPreviewPrimitiveValue(value: unknown) {
  if (Array.isArray(value) || isRecord(value)) return "";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

function jsonPreviewSummary(value: unknown) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return `${count} ${count === 1 ? "key" : "keys"}`;
  }
  return "";
}

function jsonPreviewTypeClass(type: string) {
  return cn(
    "inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
    type === "object" && "border-[var(--accent)]/30 text-[var(--accent)]",
    type === "array" && "border-[var(--status-warning)]/30 text-[var(--status-warning)]",
    type === "string" && "border-[var(--status-success)]/30 text-[var(--status-success)]",
    type === "number" && "border-[var(--accent)]/30 text-[var(--accent)]",
    type === "boolean" && "border-[var(--status-warning)]/30 text-[var(--status-warning)]",
    type === "null" && "border-[var(--border)] text-[var(--text-faint)]",
  );
}

function JsonEditableValue({
  value,
  onChange,
  onDelete,
  path,
  selectedPath,
  onSelect,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onDelete?: () => void;
  path: JsonPathSegment[];
  selectedPath: JsonPathSegment[];
  onSelect: (path: JsonPathSegment[]) => void;
}) {
  const selected = jsonPathsEqual(path, selectedPath);
  if (Array.isArray(value)) {
    return (
      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onSelect(path);
        }}
        className={cn(
          "space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3",
          selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
        )}
      >
        {value.map((item, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[112px_minmax(0,1fr)]">
            <div className="mt-0.5 flex items-center gap-1">
              <span className="min-w-6 text-right font-mono text-[10px] text-[var(--text-faint)]">
                {index}
              </span>
              <JsonIconButton
                disabled={index === 0}
                icon={ArrowUp}
                label="Move item up"
                onClick={() => {
                  const next = [...value];
                  const [moved] = next.splice(index, 1);
                  next.splice(index - 1, 0, moved);
                  onChange(next);
                }}
              />
              <JsonIconButton
                disabled={index === value.length - 1}
                icon={ArrowDown}
                label="Move item down"
                onClick={() => {
                  const next = [...value];
                  const [moved] = next.splice(index, 1);
                  next.splice(index + 1, 0, moved);
                  onChange(next);
                }}
              />
              <JsonIconButton
                icon={Copy}
                label="Duplicate item"
                onClick={() =>
                  onChange([
                    ...value.slice(0, index + 1),
                    cloneJsonValue(item),
                    ...value.slice(index + 1),
                  ])
                }
              />
              <JsonDeleteButton
                onClick={() =>
                  onChange(value.filter((_, currentIndex) => currentIndex !== index))
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <JsonEditableValue
                value={item}
                path={[...path, index]}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onChange={(next) =>
                  onChange(
                    value.map((current, currentIndex) =>
                        currentIndex === index ? next : current,
                    ),
                  )
                }
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...value, ""])}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3 w-3" strokeWidth={1.75} />
          Add item
        </button>
        {value.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">[]</span>
        )}
      </div>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return (
      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onSelect(path);
        }}
        className={cn(
          "space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3",
          selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
        )}
      >
        {entries.map(([key, item]) => (
          <div
            key={key}
            className="grid gap-2 md:grid-cols-[minmax(120px,220px)_minmax(0,1fr)_auto]"
          >
            <input
              value={key}
              onFocus={() => onSelect([...path, key])}
              onChange={(event) => {
                const nextKey = event.target.value;
                const next = { ...value };
                const currentValue = next[key];
                delete next[key];
                next[nextKey] = currentValue;
                onChange(next);
              }}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)]"
            />
            <div className="min-w-0">
              <JsonEditableValue
                value={item}
                path={[...path, key]}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
                onDelete={() => {
                  const next = { ...value };
                  delete next[key];
                  onChange(next);
                }}
              />
            </div>
            <JsonDeleteButton
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, [`key${entries.length + 1}`]: "" })}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3 w-3" strokeWidth={1.75} />
          Add key
        </button>
        {entries.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">{"{}"}</span>
        )}
      </div>
    );
  }
  return (
    <JsonPrimitiveEditor
      value={value}
      path={path}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onChange={onChange}
      onDelete={onDelete}
    />
  );
}

function JsonPrimitiveEditor({
  value,
  onChange,
  onDelete,
  path,
  selectedPath,
  onSelect,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onDelete?: () => void;
  path: JsonPathSegment[];
  selectedPath: JsonPathSegment[];
  onSelect: (path: JsonPathSegment[]) => void;
}) {
  const type =
    value === null
      ? "null"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
  return (
    <div
      onMouseDown={(event) => {
        event.stopPropagation();
        onSelect(path);
      }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-transparent px-1 py-0.5",
        jsonPathsEqual(path, selectedPath) && "border-[var(--accent)] bg-[var(--bg)]",
      )}
    >
      <select
        value={type}
        onFocus={() => onSelect(path)}
        onChange={(event) => {
          const nextType = event.target.value;
          if (nextType === "string") onChange(String(value ?? ""));
          if (nextType === "number") onChange(Number(value) || 0);
          if (nextType === "boolean") onChange(Boolean(value));
          if (nextType === "null") onChange(null);
          if (nextType === "object") onChange({});
          if (nextType === "array") onChange([]);
        }}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
      >
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="null">null</option>
        <option value="object">object</option>
        <option value="array">array</option>
      </select>
      {type === "boolean" ? (
        <input
          type="checkbox"
          checked={value === true}
          onFocus={() => onSelect(path)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4"
        />
      ) : type === "null" ? (
        <span className="font-mono text-xs text-[var(--text-faint)]">null</span>
      ) : (
        <input
          value={type === "number" ? String(value ?? 0) : String(value ?? "")}
          onFocus={() => onSelect(path)}
          onChange={(event) =>
            onChange(type === "number" ? Number(event.target.value) : event.target.value)
          }
          className={cn(
            "min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]",
            jsonPrimitiveClass(value),
          )}
        />
      )}
      {onDelete && <JsonDeleteButton onClick={onDelete} />}
    </div>
  );
}

function JsonDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
      title="Delete"
    >
      <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

function JsonBreadcrumb({
  path,
  onSelect,
}: {
  path: JsonPathSegment[];
  onSelect: (path: JsonPathSegment[]) => void;
}) {
  const segments: Array<{ label: string; path: JsonPathSegment[] }> = [
    { label: "root", path: [] },
  ];
  path.forEach((segment, index) => {
    segments.push({
      label: typeof segment === "number" ? `[${segment}]` : segment,
      path: path.slice(0, index + 1),
    });
  });
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
      {segments.map((segment, index) => (
        <button
          key={`${index}:${segment.label}`}
          type="button"
          onClick={() => onSelect(segment.path)}
          className="rounded-md px-1.5 py-1 font-mono text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {index > 0 ? "/" : ""}
          {segment.label}
        </button>
      ))}
    </nav>
  );
}

function JsonIconButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-35"
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
