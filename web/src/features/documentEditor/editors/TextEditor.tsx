import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Braces,
  Copy,
  FileCog,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  MessageSquare,
  Pilcrow,
  Plus,
  Rows3,
  Search,
  Table,
  WrapText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/chat/codeHighlight";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
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
import { isTabularJson, parseJsonContent, sortJsonValue } from "../textJsonUtils";
import {
  JsonDeleteButton,
  JsonIconButton,
  JsonPreview,
  JsonTableEditor,
  StructuredJsonEditor,
} from "../textJsonEditors";
import { jsonPreviewTypeClass } from "../textJsonPreviewUtils";

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
