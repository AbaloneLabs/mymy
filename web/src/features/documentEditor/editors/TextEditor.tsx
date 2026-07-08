import { useEffect, useEffectEvent, useRef, useState } from "react";
import { HighlightedCodeBlock } from "@/components/chat/shared/codeHighlight";
import type { EditorCommandRequest } from "../shared/commands";
import type { TextModel } from "../shared/models";
import {
  activeSourceFoldIds,
  ConfigPreview,
  countTextLines,
  cursorPosition,
  duplicateSelectedLines,
  FlatConfigEditor,
  hasTrailingTextNewline,
  handleTextEditorKeyDown,
  handleTextSourceKeyDown,
  indentTextLine,
  JsonPreview,
  JsonTableEditor,
  languageForPath,
  LargeTextSourceViewer,
  lineCommentToken,
  moveSelectedLines,
  offsetForTextLine,
  outdentTextLine,
  selectedLineRange,
  sourceFoldRanges,
  sortJsonValue,
  StructuredJsonEditor,
  textEditorKind,
  TextEditorDiagnosticsBar,
  TextEditorGoToLineBar,
  TextEditorLargeFileWarning,
  TextEditorOutlinePanel,
  TextEditorSchemaPanel,
  TextEditorSearchBar,
  TextEditorStatusBar,
  TextEditorToolbar,
  TextSourcePane,
  toggleBlockCommentRange,
  toggleCommentLine,
  transformSelectedLines,
  type SourceFoldRange,
  type TextEditorMode,
  useJsonSchemaRegistryControls,
  useTextEditorDerivedState,
  useTextEditorSearch,
  useTextSourceEditing,
} from "../text";

const LARGE_TEXT_FILE_CHAR_LIMIT = 1_000_000;
const LARGE_TEXT_FILE_LINE_LIMIT = 50_000;

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
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [mode, setMode] = useState<TextEditorMode>("source");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineDraft, setGoToLineDraft] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
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
  const schemaControls = useJsonSchemaRegistryControls(filePath);
  const kind = textEditorKind(filePath);
  const language = languageForPath(filePath, kind);
  const structured = kind === "json" || kind === "yaml" || kind === "toml";
  const json = kind === "json";
  const lineCount = countTextLines(model.content);
  const largeTextMode =
    model.content.length > LARGE_TEXT_FILE_CHAR_LIMIT ||
    lineCount > LARGE_TEXT_FILE_LINE_LIMIT;
  const foldRanges = largeTextMode ? [] : sourceFoldRanges(model.content, language);
  const activeFoldedSourceIds = activeSourceFoldIds(foldedSourceIds, foldRanges);
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
  const {
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
  } = useTextEditorDerivedState({
    activeFoldedSourceIds,
    content: model.content,
    cursorOffset: cursor.offset,
    filePath,
    foldRanges,
    json,
    kind,
    language,
    largeTextMode,
    mode,
    schemaDraft: schemaControls.schemaDraft,
    sourceSelectionRanges,
    structured,
  });

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

  function selectCurrentLine() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const range = selectedLineRange(model.content, textarea.selectionStart, textarea.selectionEnd);
    textarea.setSelectionRange(range.start, range.end);
    updateCursor();
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

  const {
    findNext,
    largeSearchNavigationForQuery,
    largeSearchRange,
    replaceAll,
    replaceNext,
    searchMatches,
    streamingSearchCountForQuery,
  } = useTextEditorSearch({
    caseSensitive,
    content: model.content,
    focusSourceRange,
    largeTextMode,
    regexSearch,
    replaceDraft,
    searchDraft,
    sourceRef,
    updateContent,
    wholeWord,
  });

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
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) =>
        handleTextEditorKeyDown(event, {
          json,
          setTableMode: () => setMode("table"),
          setTreeMode: () => setMode("tree"),
          structured,
          togglePreviewMode,
        })
      }
    >
      <TextEditorToolbar
        activeMode={activeMode}
        blockCommentsAvailable={Boolean(blockComments)}
        bom={model.bom}
        encoding={model.encoding}
        goToLineOpen={goToLineOpen}
        json={json}
        language={language}
        lineEnding={model.lineEnding}
        outlineOpen={outlineOpen}
        schemaOpen={schemaOpen}
        searchOpen={searchOpen}
        structured={structured}
        tableAvailable={tableAvailable}
        onBomChange={(bom) => onChange({ ...model, bom })}
        onDuplicateSelection={duplicateSelection}
        onEnsureFinalNewline={ensureFinalNewline}
        onFormatJson={formatJson}
        onIndentSelection={indentSelection}
        onLineEndingChange={(lineEnding) => onChange({ ...model, lineEnding })}
        onMinifyJson={minifyJson}
        onMoveSelection={moveSelection}
        onOutdentSelection={outdentSelection}
        onSetMode={setMode}
        onSortJsonKeys={sortJsonKeys}
        onToggleBlockComment={toggleBlockComment}
        onToggleGoToLine={() => {
          setGoToLineDraft(String(cursor.line));
          setGoToLineOpen((current) => !current);
        }}
        onToggleLineComment={toggleLineComment}
        onToggleOutline={() => setOutlineOpen((current) => !current)}
        onTogglePreview={togglePreviewMode}
        onToggleSchema={() => setSchemaOpen((current) => !current)}
        onToggleSearch={() => setSearchOpen((current) => !current)}
        onTrimTrailingWhitespace={trimTrailingWhitespace}
      />
      {searchOpen && (
        <TextEditorSearchBar
          caseSensitive={caseSensitive}
          largeSearchNavigation={largeSearchNavigationForQuery}
          largeTextMode={largeTextMode}
          regexSearch={regexSearch}
          replaceDraft={replaceDraft}
          searchDraft={searchDraft}
          searchMatches={searchMatches}
          streamingSearchCount={streamingSearchCountForQuery}
          wholeWord={wholeWord}
          onCaseSensitiveChange={setCaseSensitive}
          onFindNext={findNext}
          onRegexSearchChange={setRegexSearch}
          onReplaceAll={replaceAll}
          onReplaceDraftChange={setReplaceDraft}
          onReplaceNext={replaceNext}
          onSearchDraftChange={setSearchDraft}
          onWholeWordChange={setWholeWord}
        />
      )}
      {goToLineOpen && (
        <TextEditorGoToLineBar
          draft={goToLineDraft}
          lineCount={lineCount}
          onClose={() => setGoToLineOpen(false)}
          onDraftChange={setGoToLineDraft}
          onSubmit={submitGoToLine}
        />
      )}
      {json && schemaOpen && (
        <TextEditorSchemaPanel
          schemaDiagnosticsCount={schemaDiagnostics.length}
          schemaDraft={schemaControls.schemaDraft}
          schemaDraftError={schemaControls.schemaDraftError}
          schemaNameDraft={schemaControls.schemaNameDraft}
          schemaRegistry={schemaControls.schemaRegistry}
          selectedSchema={schemaControls.selectedSchema}
          selectedSchemaId={schemaControls.selectedSchemaId}
          onDeleteSelectedSchema={schemaControls.deleteSelectedSchema}
          onSaveCurrentSchema={schemaControls.saveCurrentSchema}
          onSchemaDraftChange={schemaControls.setSchemaDraft}
          onSchemaNameDraftChange={schemaControls.setSchemaNameDraft}
          onSelectSchema={schemaControls.selectSchema}
          onStartNewSchema={schemaControls.startNewSchema}
        />
      )}
      {largeTextMode && <TextEditorLargeFileWarning />}
      {diagnostics.length > 0 && (
        <TextEditorDiagnosticsBar
          diagnostics={diagnostics}
          onFocusLine={focusSourceLine}
        />
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
              onKeyDown={(event) =>
                handleTextSourceKeyDown(event, {
                  activateRectangularSourceSelection,
                  addNextSourceSelection,
                  applySourceEdit,
                  content: model.content,
                  cursorLine: cursor.line,
                  duplicateSelection,
                  folded: activeFoldedSourceIds.size > 0,
                  formatJson,
                  handleSourceMultiCursorKey,
                  indentSelection,
                  json,
                  kind,
                  minifyJson,
                  moveSelection,
                  openGoToLine: (line) => {
                    setGoToLineDraft(String(line));
                    setGoToLineOpen(true);
                  },
                  openSearch: () => setSearchOpen(true),
                  outdentSelection,
                  selectCurrentLine,
                  setTableMode: () => setMode("table"),
                  setTreeMode: () => setMode("tree"),
                  sortJsonKeys,
                  structured,
                  toggleBlockComment,
                  toggleLineComment,
                  togglePreviewMode,
                  toggleSchema: () => setSchemaOpen((current) => !current),
                  unfoldAll: () => setFoldedSourceIds(new Set()),
                })
              }
              onPaste={handleSourcePaste}
              onCursorUpdate={updateCursor}
              onScroll={syncLineNumberScroll}
              onFocusLine={focusSourceLine}
              onToggleFold={toggleSourceFold}
            />
          )}
        </div>
        {outlineOpen && (
          <TextEditorOutlinePanel
            outline={outline}
            onClose={() => setOutlineOpen(false)}
            onFocusLine={focusSourceLine}
          />
        )}
      </div>
      <TextEditorStatusBar
        bracketMatch={bracketMatch}
        cursor={cursor}
        largeTextMode={largeTextMode}
        lineEnding={model.lineEnding}
        pasteProgress={pasteProgress}
        sourceSelectionCount={sourceSelectionRanges.length}
        stats={stats}
      />
    </div>
  );
}
