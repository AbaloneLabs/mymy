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

type TextEditorKind = "json" | "yaml" | "toml" | "code" | "text";
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

interface SourceEdit {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
}

interface SourceDiagnostic {
  line?: number;
  path?: string;
  message: string;
}

interface SourceOutlineItem {
  line: number;
  kind: string;
  label: string;
}

type JsonPathSegment = string | number;

interface JsonTableRow {
  key?: string;
  value: Record<string, unknown>;
}

interface JsonTableModel {
  kind: "array" | "object";
  rows: JsonTableRow[];
  columns: string[];
}

interface ConfigEntry {
  lineIndex: number;
  key: string;
  value: string;
  path: string[];
  section?: string;
  indent: string;
  suffix: string;
  keyEditable: boolean;
  entryKind: "mapping" | "sequence" | "toml";
}

function textEditorKind(filePath: string): TextEditorKind {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "toml") return "toml";
  if (
    [
      "css",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "rs",
      "py",
      "sh",
      "bash",
      "sql",
      "xml",
      "html",
      "htm",
    ].includes(extension)
  ) {
    return "code";
  }
  return "text";
}

function languageForPath(filePath: string, kind: TextEditorKind) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "json") return "json";
  if (kind === "yaml") return "yaml";
  if (kind === "toml") return "toml";
  const aliases: Record<string, string> = {
    cjs: "javascript",
    htm: "html",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[extension] ?? (extension || "text");
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

function selectedLineRange(content: string, start: number, end: number) {
  const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = content.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
  return { start: lineStart, end: lineEnd };
}

function transformSelectedLines(
  content: string,
  start: number,
  end: number,
  transform: (line: string) => string,
): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const trailingNewline = block.endsWith("\n");
  const body = trailingNewline ? block.slice(0, -1) : block;
  const nextBody = body.split("\n").map(transform).join("\n");
  const nextBlock = trailingNewline ? `${nextBody}\n` : nextBody;
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.start,
    selectionEnd: range.start + nextBlock.length,
  };
}

function indentTextLine(line: string) {
  return `  ${line}`;
}

function outdentTextLine(line: string) {
  return line.replace(/^( {1,2}|\t)/, "");
}

function lineCommentToken(filePath: string, kind: TextEditorKind) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "yaml" || kind === "toml") return "#";
  if (["py", "sh", "bash"].includes(extension)) return "#";
  if (extension === "sql") return "--";
  return "//";
}

function blockCommentTokens(filePath: string, kind: TextEditorKind) {
  if (kind !== "code") return null;
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["html", "htm", "xml"].includes(extension)) {
    return { open: "<!--", close: "-->" };
  }
  if (["css", "js", "jsx", "mjs", "cjs", "ts", "tsx", "rs", "sql"].includes(extension)) {
    return { open: "/*", close: "*/" };
  }
  return null;
}

function toggleCommentLine(line: string, token: string) {
  if (!line.trim()) return line;
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length);
  if (rest.startsWith(`${token} `)) return `${indent}${rest.slice(token.length + 1)}`;
  if (rest.startsWith(token)) return `${indent}${rest.slice(token.length)}`;
  return `${indent}${token} ${rest}`;
}

function toggleBlockCommentRange(
  content: string,
  start: number,
  end: number,
  tokens: { open: string; close: string },
): SourceEdit {
  const range = start === end ? selectedLineContentRange(content, start) : { start, end };
  const selection = content.slice(range.start, range.end);
  const leading = /^\s*/.exec(selection)?.[0] ?? "";
  const trailing = /\s*$/.exec(selection)?.[0] ?? "";
  const innerStart = range.start + leading.length;
  const innerEnd = Math.max(innerStart, range.end - trailing.length);
  const inner = content.slice(innerStart, innerEnd);
  if (isBlockCommented(inner, tokens)) {
    const unwrapped = unwrapBlockComment(inner, tokens);
    return {
      content: `${content.slice(0, innerStart)}${unwrapped}${content.slice(innerEnd)}`,
      selectionStart: innerStart,
      selectionEnd: innerStart + unwrapped.length,
    };
  }
  const wrapped = wrapBlockComment(inner, tokens);
  const caretStart =
    inner.length === 0 ? innerStart + tokens.open.length + 1 : innerStart;
  const caretEnd =
    inner.length === 0 ? caretStart : innerStart + wrapped.length;
  return {
    content: `${content.slice(0, innerStart)}${wrapped}${content.slice(innerEnd)}`,
    selectionStart: caretStart,
    selectionEnd: caretEnd,
  };
}

function selectedLineContentRange(content: string, offset: number) {
  const range = selectedLineRange(content, offset, offset);
  const hasTrailingNewline = content.slice(range.start, range.end).endsWith("\n");
  return {
    start: range.start,
    end: hasTrailingNewline ? range.end - 1 : range.end,
  };
}

function isBlockCommented(inner: string, tokens: { open: string; close: string }) {
  return inner.startsWith(tokens.open) && inner.endsWith(tokens.close);
}

function unwrapBlockComment(inner: string, tokens: { open: string; close: string }) {
  let unwrapped = inner.slice(tokens.open.length, inner.length - tokens.close.length);
  if (unwrapped.startsWith("\n") && unwrapped.endsWith("\n")) {
    return unwrapped.slice(1, -1);
  }
  if (unwrapped.startsWith(" ")) unwrapped = unwrapped.slice(1);
  if (unwrapped.endsWith(" ")) unwrapped = unwrapped.slice(0, -1);
  return unwrapped;
}

function wrapBlockComment(inner: string, tokens: { open: string; close: string }) {
  if (!inner) return `${tokens.open} ${tokens.close}`;
  if (inner.includes("\n")) return `${tokens.open}\n${inner}\n${tokens.close}`;
  return `${tokens.open} ${inner} ${tokens.close}`;
}

function autoPairSource(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  content: string,
  kind: TextEditorKind,
  applyEdit: (edit: SourceEdit | null) => void,
) {
  const nativeEvent = event.nativeEvent;
  if (kind === "text" || nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const textarea = event.currentTarget;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end && isAutoPairClosingKey(event.key) && content[start] === event.key) {
    textarea.setSelectionRange(start + 1, start + 1);
    return true;
  }
  const close = autoPairClosingToken(event.key);
  if (!close) return false;
  const selected = content.slice(start, end);
  const inserted = `${event.key}${selected}${close}`;
  applyEdit({
    content: `${content.slice(0, start)}${inserted}${content.slice(end)}`,
    selectionStart: selected.length > 0 ? start + 1 : start + 1,
    selectionEnd: selected.length > 0 ? end + 1 : start + 1,
  });
  return true;
}

function autoPairClosingToken(key: string) {
  const pairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    "(": ")",
    "[": "]",
    "{": "}",
    "`": "`",
  };
  return pairs[key] ?? null;
}

function isAutoPairClosingKey(key: string) {
  return [")", "]", "}", '"', "'", "`"].includes(key);
}

function duplicateSelectedLines(content: string, start: number, end: number): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const nextBlock = block.endsWith("\n") ? block : `${block}\n`;
  return {
    content: `${content.slice(0, range.end)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.end,
    selectionEnd: range.end + nextBlock.length,
  };
}

function moveSelectedLines(
  content: string,
  start: number,
  end: number,
  direction: -1 | 1,
): SourceEdit | null {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  if (direction < 0) {
    if (range.start === 0) return null;
    const previousStart = content.lastIndexOf("\n", Math.max(0, range.start - 2)) + 1;
    const previousBlock = content.slice(previousStart, range.start);
    return {
      content: `${content.slice(0, previousStart)}${block}${previousBlock}${content.slice(range.end)}`,
      selectionStart: previousStart,
      selectionEnd: previousStart + block.length,
    };
  }
  if (range.end >= content.length) return null;
  const nextLineEndIndex = content.indexOf("\n", range.end);
  const nextEnd = nextLineEndIndex === -1 ? content.length : nextLineEndIndex + 1;
  const nextBlock = content.slice(range.end, nextEnd);
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${block}${content.slice(nextEnd)}`,
    selectionStart: range.start + nextBlock.length,
    selectionEnd: range.start + nextBlock.length + block.length,
  };
}

function cursorPosition(content: string, start: number, end: number) {
  const before = content.slice(0, start);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
    selection: Math.abs(end - start),
  };
}

function offsetForTextLine(content: string, line: number) {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = content.indexOf("\n", offset);
    if (next === -1) return content.length;
    offset = next + 1;
  }
  return offset;
}

function textStats(content: string) {
  return {
    lines: countTextLines(content),
    characters: content.length,
  };
}

function countTextLines(content: string) {
  if (!content) return 1;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function lineEndingLabel(value: string | undefined) {
  if (value === "\r\n") return "CRLF";
  if (value === "\r") return "CR";
  return "LF";
}

function lineEndingValue(value: string | undefined) {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}

function hasTrailingTextNewline(content: string) {
  return content.endsWith("\n") || content.endsWith("\r");
}

function sourceDiagnostics(content: string, kind: TextEditorKind): SourceDiagnostic[] {
  if (kind === "json") {
    try {
      JSON.parse(content || "null");
      return [];
    } catch (error) {
      return [jsonParseDiagnostic(content, error)];
    }
  }
  if (kind === "yaml") {
    const diagnostics = content
      .split("\n")
      .map((line, index): SourceDiagnostic | null =>
        /^\t+/.test(line)
          ? { line: index + 1, message: "YAML indentation should use spaces." }
          : null,
      )
      .filter((diagnostic): diagnostic is SourceDiagnostic => Boolean(diagnostic));
    diagnostics.push(...duplicateConfigPathDiagnostics(content, "yaml"));
    return diagnostics;
  }
  if (kind === "toml") {
    return duplicateConfigPathDiagnostics(content, "toml");
  }
  return [];
}

function textSourceOutline(content: string, language: string): SourceOutlineItem[] {
  const items: SourceOutlineItem[] = [];
  content.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const item =
      outlineJavaScriptLike(trimmed, language) ??
      outlinePython(trimmed, language) ??
      outlineRust(trimmed, language) ??
      outlineShell(trimmed, language) ??
      outlineSql(trimmed, language) ??
      outlineCss(trimmed, language) ??
      outlineXmlLike(trimmed, language) ??
      outlineStructuredText(trimmed, language);
    if (item) items.push({ ...item, line: lineNumber });
  });
  return items.slice(0, 500);
}

function outlineJavaScriptLike(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (!["javascript", "typescript", "jsx", "tsx"].includes(language)) return null;
  const declaration =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (!declaration) return null;
  return { kind: "symbol", label: declaration[1] };
}

function outlinePython(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "python") return null;
  const match = /^(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/.exec(line);
  return match ? { kind: match[1], label: match[2] } : null;
}

function outlineRust(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "rs") return null;
  const match = /^(?:pub(?:\([^)]*\))?\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_][\w]*)?/.exec(line);
  if (!match) return null;
  return { kind: match[1], label: match[2] ?? line.replace(/\s*\{.*$/, "") };
}

function outlineShell(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "bash" && language !== "shellscript") return null;
  const match = /^(?:function\s+)?([A-Za-z_][\w-]*)\s*(?:\(\))?\s*\{/.exec(line);
  return match ? { kind: "function", label: match[1] } : null;
}

function outlineSql(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "sql") return null;
  const match = /^create\s+(table|view|function|procedure|index)\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."`]+)/i.exec(line);
  return match ? { kind: match[1].toLowerCase(), label: match[2] } : null;
}

function outlineCss(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "css") return null;
  if (!line.endsWith("{")) return null;
  return { kind: "selector", label: line.slice(0, -1).trim() };
}

function outlineXmlLike(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "xml" && language !== "html") return null;
  const heading = /^<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1>/i.exec(line);
  if (heading) return { kind: `h${heading[1]}`, label: heading[2].replace(/<[^>]+>/g, "") };
  const id = /^<([A-Za-z][\w:-]*)(?:\s[^>]*\sid=["']([^"']+)["'][^>]*)?>/.exec(line);
  if (!id) return null;
  return { kind: id[1], label: id[2] ?? id[1] };
}

function outlineStructuredText(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language === "json") {
    const match = /^"([^"]+)"\s*:/.exec(line);
    return match ? { kind: "key", label: match[1] } : null;
  }
  if (language === "yaml") {
    const match = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
    return match ? { kind: "key", label: match[1] } : null;
  }
  if (language === "toml") {
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) return { kind: "section", label: section[1] };
    const key = /^([A-Za-z0-9_.-]+)\s*=/.exec(line);
    return key ? { kind: "key", label: key[1] } : null;
  }
  return null;
}

function jsonSchemaDiagnostics(
  value: unknown,
  schemaContent: string,
  enabled: boolean,
): SourceDiagnostic[] {
  if (!enabled || !schemaContent.trim()) return [];
  let schema: unknown;
  try {
    schema = JSON.parse(schemaContent);
  } catch (error) {
    return [
      {
        path: "schema",
        message: error instanceof Error ? error.message : "Invalid JSON Schema",
      },
    ];
  }
  if (value === undefined) return [];
  return validateJsonSchemaValue(value, schema, "$");
}

function validateJsonSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
): SourceDiagnostic[] {
  if (!isRecord(schema)) return [];
  const diagnostics: SourceDiagnostic[] = [];
  const expectedTypes = jsonSchemaTypes(schema.type);
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => jsonValueMatchesType(value, type))) {
    diagnostics.push({
      path,
      message: `Expected ${expectedTypes.join(" or ")}, got ${jsonValueType(value)}.`,
    });
    return diagnostics;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => stableJsonLike(item) === stableJsonLike(value))) {
    diagnostics.push({ path, message: "Value is not in schema enum." });
  }
  if ("const" in schema && stableJsonLike(schema.const) !== stableJsonLike(value)) {
    diagnostics.push({ path, message: "Value does not match schema const." });
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    required.forEach((key) => {
      if (!(key in value)) diagnostics.push({ path: `${path}.${key}`, message: "Required key is missing." });
    });
    if (isRecord(schema.properties)) {
      Object.entries(schema.properties).forEach(([key, propertySchema]) => {
        if (key in value) {
          diagnostics.push(
            ...validateJsonSchemaValue(value[key], propertySchema, `${path}.${key}`),
          );
        }
      });
    }
    if (schema.additionalProperties === false && isRecord(schema.properties)) {
      const properties = schema.properties;
      Object.keys(value).forEach((key) => {
        if (!(key in properties)) {
          diagnostics.push({
            path: `${path}.${key}`,
            message: "Additional property is not allowed.",
          });
        }
      });
    }
  }

  if (Array.isArray(value) && schema.items) {
    const minItems = jsonSchemaNumber(schema.minItems);
    const maxItems = jsonSchemaNumber(schema.maxItems);
    if (minItems !== undefined && value.length < minItems) {
      diagnostics.push({ path, message: `Expected at least ${minItems} items.` });
    }
    if (maxItems !== undefined && value.length > maxItems) {
      diagnostics.push({ path, message: `Expected at most ${maxItems} items.` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      value.forEach((item, index) => {
        const key = stableJsonLike(item);
        if (seen.has(key)) {
          diagnostics.push({
            path: `${path}[${index}]`,
            message: "Array item is not unique.",
          });
        }
        seen.add(key);
      });
    }
    value.forEach((item, index) => {
      diagnostics.push(
        ...validateJsonSchemaValue(item, schema.items, `${path}[${index}]`),
      );
    });
  }

  if (typeof value === "string") {
    const minLength = jsonSchemaNumber(schema.minLength);
    const maxLength = jsonSchemaNumber(schema.maxLength);
    if (minLength !== undefined && value.length < minLength) {
      diagnostics.push({ path, message: `Expected at least ${minLength} characters.` });
    }
    if (maxLength !== undefined && value.length > maxLength) {
      diagnostics.push({ path, message: `Expected at most ${maxLength} characters.` });
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          diagnostics.push({ path, message: "String does not match schema pattern." });
        }
      } catch {
        diagnostics.push({ path: "schema.pattern", message: "Invalid schema pattern." });
      }
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const minimum = jsonSchemaNumber(schema.minimum);
    const maximum = jsonSchemaNumber(schema.maximum);
    const exclusiveMinimum = jsonSchemaNumber(schema.exclusiveMinimum);
    const exclusiveMaximum = jsonSchemaNumber(schema.exclusiveMaximum);
    if (minimum !== undefined && value < minimum) {
      diagnostics.push({ path, message: `Expected value >= ${minimum}.` });
    }
    if (maximum !== undefined && value > maximum) {
      diagnostics.push({ path, message: `Expected value <= ${maximum}.` });
    }
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      diagnostics.push({ path, message: `Expected value > ${exclusiveMinimum}.` });
    }
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      diagnostics.push({ path, message: `Expected value < ${exclusiveMaximum}.` });
    }
  }

  return diagnostics;
}

function jsonSchemaTypes(value: unknown) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function jsonValueMatchesType(value: unknown, type: string) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function jsonValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function stableJsonLike(value: unknown) {
  return JSON.stringify(value);
}

function jsonParseDiagnostic(content: string, error: unknown): SourceDiagnostic {
  const message = error instanceof Error ? error.message : "Invalid JSON";
  const position = /position\s+(\d+)/i.exec(message)?.[1];
  if (!position) return { message };
  const offset = Number(position);
  if (!Number.isFinite(offset)) return { message };
  const cursor = cursorPosition(content, offset, offset);
  return {
    line: cursor.line,
    message: `${message} at column ${cursor.column}`,
  };
}

function jsonSchemaNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildSearchRegex(query: string, options: SearchOptions) {
  if (!query) return null;
  const source = options.regexSearch ? query : escapeRegExp(query);
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function countSearchMatches(content: string, query: string, options: SearchOptions) {
  const regex = buildSearchRegex(query, options);
  if (!regex) return 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    if (match[0].length === 0) break;
    count += 1;
  }
  return count;
}

function nextSearchRange(
  content: string,
  query: string,
  options: SearchOptions & { start: number },
) {
  const regex = buildSearchRegex(query, options);
  if (!regex) return null;
  regex.lastIndex = options.start;
  let match = regex.exec(content);
  if (!match) {
    regex.lastIndex = 0;
    match = regex.exec(content);
  }
  if (!match || match[0].length === 0) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}

function parseFlatConfig(content: string, kind: "yaml" | "toml") {
  return kind === "yaml" ? parseYamlConfig(content) : parseTomlConfig(content);
}

function duplicateConfigPathDiagnostics(
  content: string,
  kind: "yaml" | "toml",
): SourceDiagnostic[] {
  const seen = new Map<string, number>();
  const diagnostics: SourceDiagnostic[] = [];
  for (const entry of parseFlatConfig(content, kind).entries) {
    const path = configEntryPathLabel(entry);
    const existingLine = seen.get(path);
    if (existingLine !== undefined) {
      diagnostics.push({
        line: entry.lineIndex + 1,
        path,
        message: `Duplicate key; first defined on line ${existingLine}.`,
      });
      continue;
    }
    seen.set(path, entry.lineIndex + 1);
  }
  return diagnostics;
}

function parseYamlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  const stack: Array<{ indent: number; key: string }> = [];
  const sequenceCounters = new Map<string, number>();
  let unsupportedCount = 0;
  content.split("\n").forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") {
      return;
    }
    const indent = leadingWhitespace(line);
    const indentSize = indent.length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indentSize) {
      stack.pop();
    }
    const mapping = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (mapping) {
      const key = mapping[2];
      const parsed = splitInlineComment(mapping[3]);
      const path = [...stack.map((item) => item.key), key];
      if (!parsed.value) {
        stack.push({ indent: indentSize, key });
        return;
      }
      entries.push({
        lineIndex,
        key,
        value: parsed.value,
        path,
        indent,
        suffix: parsed.suffix,
        keyEditable: true,
        entryKind: "mapping",
      });
      return;
    }
    const sequence = /^(\s*)-\s*(.*?)\s*$/.exec(line);
    if (sequence) {
      const parentPath = stack.map((item) => item.key);
      const parentKey = parentPath.join(".");
      const index = sequenceCounters.get(parentKey) ?? 0;
      sequenceCounters.set(parentKey, index + 1);
      const parsed = splitInlineComment(sequence[2]);
      if (!parsed.value || /^[A-Za-z0-9_.-]+\s*:\s*/.test(parsed.value)) {
        unsupportedCount += 1;
        return;
      }
      entries.push({
        lineIndex,
        key: `[${index}]`,
        value: parsed.value,
        path: [...parentPath, `[${index}]`],
        indent,
        suffix: parsed.suffix,
        keyEditable: false,
        entryKind: "sequence",
      });
      return;
    }
    unsupportedCount += 1;
  });
  return { entries, unsupportedCount };
}

function parseTomlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  let unsupportedCount = 0;
  let currentSection = "";
  content.split("\n").forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const table = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(trimmed);
    if (arrayTable || table) {
      currentSection = (arrayTable?.[1] ?? table?.[1] ?? "").trim();
      return;
    }
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      unsupportedCount += 1;
      return;
    }
    const key = match[2];
    const parsed = splitInlineComment(match[3]);
    const sectionPath = currentSection ? currentSection.split(".").filter(Boolean) : [];
    entries.push({
      lineIndex,
      key,
      value: parsed.value,
      path: [...sectionPath, ...key.split(".").filter(Boolean)],
      section: currentSection,
      indent: match[1],
      suffix: parsed.suffix,
      keyEditable: true,
      entryKind: "toml",
    });
  });
  return { entries, unsupportedCount };
}

function flatConfigLine(
  entry: ConfigEntry,
  key: string,
  value: string,
  kind: "yaml" | "toml",
) {
  if (kind === "toml") return `${entry.indent}${key} = ${value}${entry.suffix}`;
  if (entry.entryKind === "sequence") return `${entry.indent}- ${value}${entry.suffix}`;
  return `${entry.indent}${key}: ${value}${entry.suffix}`;
}

function appendFlatConfigEntry(
  content: string,
  entry: {
    key: string;
    kind: "yaml" | "toml";
    section: string;
    value: string;
  },
) {
  if (entry.kind === "yaml") {
    return appendYamlConfigEntry(content, entry.section, entry.key, entry.value);
  }
  if (!entry.section) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${entry.key} = ${entry.value}\n`;
  }
  const lines = content.split("\n");
  const sectionHeader = `[${entry.section}]`;
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);
  if (sectionIndex < 0) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${sectionHeader}\n${entry.key} = ${entry.value}\n`;
  }
  let insertAt = sectionIndex + 1;
  while (insertAt < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[insertAt])) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, `${entry.key} = ${entry.value}`);
  return lines.join("\n");
}

function appendYamlConfigEntry(content: string, parentPath: string, key: string, value: string) {
  const lines = content.split("\n");
  const path = parentPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (path.length === 0) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${key}: ${value}\n`;
  }
  const parent = findYamlParentLine(lines, path);
  if (!parent) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${path.map((segment, index) => `${"  ".repeat(index)}${segment}:`).join("\n")}\n${"  ".repeat(path.length)}${key}: ${value}\n`;
  }
  let insertAt = parent.lineIndex + 1;
  while (
    insertAt < lines.length &&
    (lines[insertAt].trim() === "" ||
      leadingWhitespace(lines[insertAt]).length > parent.indent)
  ) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, `${" ".repeat(parent.indent + 2)}${key}: ${value}`);
  return lines.join("\n");
}

function findYamlParentLine(
  lines: string[],
  path: string[],
): { lineIndex: number; indent: number } | null {
  const stack: Array<{ indent: number; key: string }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const currentPath = [...stack.map((item) => item.key), match[2]];
    if (currentPath.join(".") === path.join(".") && !match[3].trim()) {
      return { lineIndex, indent };
    }
    if (!match[3].trim()) stack.push({ indent, key: match[2] });
  }
  return null;
}

function configEntryParentLabel(entry: ConfigEntry) {
  if (entry.path.length <= 1) return entry.section || "root";
  return entry.path.slice(0, -1).join(".");
}

function configEntryPathLabel(entry: ConfigEntry) {
  return entry.path.length > 0 ? entry.path.join(".") : "root";
}

function configScalarType(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (/^(true|false)$/i.test(trimmed)) return "boolean";
  if (/^(null|~)$/i.test(trimmed)) return "null";
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return "number";
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    return "object";
  }
  return "string";
}

function leadingWhitespace(value: string) {
  return /^\s*/.exec(value)?.[0] ?? "";
}

function splitInlineComment(value: string) {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if ((ch === '"' || ch === "'") && value[index - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
    }
    if (ch === "#" && quote === null && (index === 0 || /\s/.test(value[index - 1]))) {
      return {
        value: value.slice(0, index).trimEnd(),
        suffix: value.slice(index > 0 ? index - 1 : index),
      };
    }
  }
  return { value: value.trimEnd(), suffix: "" };
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

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}

function jsonPathsEqual(left: JsonPathSegment[], right: JsonPathSegment[]) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function parentJsonPath(path: JsonPathSegment[]) {
  return path.slice(0, Math.max(0, path.length - 1));
}

function jsonPathLabel(path: JsonPathSegment[]) {
  if (path.length === 0) return "$";
  return path.reduce(
    (label, segment) =>
      typeof segment === "number" ? `${label}[${segment}]` : `${label}.${segment}`,
    "$",
  );
}

function getJsonPathValue(value: unknown, path: JsonPathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === "string") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function jsonPathExists(value: unknown, path: JsonPathSegment[]) {
  if (path.length === 0) return true;
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number" && segment in current) {
      current = current[segment];
    } else if (isRecord(current) && typeof segment === "string" && segment in current) {
      current = current[segment];
    } else {
      return false;
    }
  }
  return true;
}

function setJsonPathValue(value: unknown, path: JsonPathSegment[], nextValue: unknown): unknown {
  if (path.length === 0) return nextValue;
  const [segment, ...rest] = path;
  if (Array.isArray(value) && typeof segment === "number") {
    return value.map((item, index) =>
      index === segment ? setJsonPathValue(item, rest, nextValue) : item,
    );
  }
  if (isRecord(value) && typeof segment === "string") {
    return {
      ...value,
      [segment]: setJsonPathValue(value[segment], rest, nextValue),
    };
  }
  return value;
}

function deleteJsonPathValue(value: unknown, path: JsonPathSegment[]): unknown {
  if (path.length === 0) return value;
  if (path.length === 1) {
    const [segment] = path;
    if (Array.isArray(value) && typeof segment === "number") {
      return value.filter((_, index) => index !== segment);
    }
    if (isRecord(value) && typeof segment === "string") {
      const next = { ...value };
      delete next[segment];
      return next;
    }
    return value;
  }
  const [segment, ...rest] = path;
  if (Array.isArray(value) && typeof segment === "number") {
    return value.map((item, index) =>
      index === segment ? deleteJsonPathValue(item, rest) : item,
    );
  }
  if (isRecord(value) && typeof segment === "string") {
    return {
      ...value,
      [segment]: deleteJsonPathValue(value[segment], rest),
    };
  }
  return value;
}

function firstJsonChildPathSegment(value: unknown): JsonPathSegment | null {
  if (Array.isArray(value)) return value.length > 0 ? 0 : null;
  if (isRecord(value)) return Object.keys(value)[0] ?? null;
  return null;
}

function nextJsonObjectKey(value: Record<string, unknown>, prefix = "key") {
  let index = Object.keys(value).length + 1;
  let key = `${prefix}${index}`;
  while (key in value) {
    index += 1;
    key = `${prefix}${index}`;
  }
  return key;
}

function insertJsonObjectEntry(
  value: Record<string, unknown>,
  afterKey: string,
  key: string,
  insertedValue: unknown,
) {
  const entries = Object.entries(value);
  const result: Record<string, unknown> = {};
  let inserted = false;
  for (const [entryKey, entryValue] of entries) {
    result[entryKey] = entryValue;
    if (entryKey === afterKey) {
      result[key] = insertedValue;
      inserted = true;
    }
  }
  if (!inserted) result[key] = insertedValue;
  return result;
}

function jsonEditorValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function coerceJsonEditorValue(value: unknown, nextType: string): unknown {
  if (nextType === "object") return isRecord(value) ? value : {};
  if (nextType === "array") return Array.isArray(value) ? value : [];
  if (nextType === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
  }
  if (nextType === "boolean") return Boolean(value);
  if (nextType === "null") return null;
  return typeof value === "string" ? value : String(value ?? "");
}

function jsonPrimitiveClass(value: unknown) {
  if (typeof value === "string") return "text-[var(--status-success)]";
  if (typeof value === "number") return "text-[var(--accent)]";
  if (typeof value === "boolean") return "text-[var(--status-warning)]";
  if (value === null) return "text-[var(--text-faint)]";
  return "text-[var(--text-muted)]";
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content || "null");
  } catch {
    return undefined;
  }
}

function isTabularJson(value: unknown) {
  return tabularJsonModel(value) !== null;
}

function tabularJsonModel(value: unknown): JsonTableModel | null {
  if (Array.isArray(value) && value.every((item) => isRecord(item))) {
    const records = value as Array<Record<string, unknown>>;
    return {
      kind: "array",
      rows: records.map((row) => ({ value: row })),
      columns: jsonTableColumns(records),
    };
  }
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => isRecord(item))) return null;
  const records = entries.map(([, item]) => item as Record<string, unknown>);
  return {
    kind: "object",
    rows: entries.map(([key, item]) => ({
      key,
      value: item as Record<string, unknown>,
    })),
    columns: jsonTableColumns(records),
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  );
}

function jsonTableColumns(rows: Array<Record<string, unknown>>) {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return Array.from(columns);
}

function nextJsonColumnKey(columns: string[]) {
  let index = columns.length + 1;
  while (columns.includes(`key${index}`)) index += 1;
  return `key${index}`;
}

function nextJsonTableObjectKey(rows: JsonTableRow[], prefix = "row") {
  const existing = new Set(rows.map((row) => row.key).filter(Boolean));
  let index = rows.length + 1;
  let key = `${prefix}${index}`;
  while (existing.has(key)) {
    index += 1;
    key = `${prefix}${index}`;
  }
  return key;
}

function jsonCellToString(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseJsonCell(value: string, previous: unknown) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (typeof previous === "number" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
