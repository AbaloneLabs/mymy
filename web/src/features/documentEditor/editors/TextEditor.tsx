import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { HighlightedCodeBlock } from "@/components/chat/shared/codeHighlight";
import type { EditorCommandRequest } from "../shared/commands";
import type { TextModel } from "../shared/models";
import {
  activeSourceFoldIds,
  changedTextFileFormatKeys,
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
  languageServiceCompletionRange,
  languageServiceCompletions,
  languageServiceHover,
  languageForPath,
  largeTextFilePolicy,
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
  textFileFormatDraft,
  textFileFormatImpact,
  textFileFormatIssue,
  TextFormatDraftBar,
  TextEditorDiagnosticsBar,
  TextEditorGoToLineBar,
  TextEditorLargeFileWarning,
  TextEditorLanguageAssistPanel,
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
  type TextFileFormatDraft,
  type TextEditorMode,
  useJsonSchemaRegistryControls,
  useTextEditorDerivedState,
  useTextEditorSearch,
  useTextSourceEditing,
} from "../text";

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
  const [sourceScrollLeft, setSourceScrollLeft] = useState(0);
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [languageAssistOpen, setLanguageAssistOpen] = useState(false);
  const [formatEdit, setFormatEdit] = useState<{
    baseline: TextFileFormatDraft;
    draft: TextFileFormatDraft;
  } | null>(null);
  const [largeLineRequest, setLargeLineRequest] = useState<{
    line: number;
    token: number;
  } | null>(null);
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
  const largeFilePolicy = largeTextFilePolicy(model.content.length, lineCount);
  const largeTextMode = largeFilePolicy.mode !== "normal";
  const largeTextReadOnly = largeFilePolicy.mode === "read-only";
  const currentFileFormat = textFileFormatDraft(model);
  const formatChangedKeys = formatEdit
    ? changedTextFileFormatKeys(formatEdit.baseline, formatEdit.draft)
    : [];
  const formatIssue = formatEdit
    ? textFileFormatIssue(model.content, formatEdit.draft)
    : null;
  const formatConflict = formatEdit
    ? changedTextFileFormatKeys(formatEdit.baseline, currentFileFormat).length > 0
    : false;
  const formatImpact = textFileFormatImpact(
    model.content,
    formatEdit?.draft ?? currentFileFormat,
  );
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
  const languageAssistEnabled = !largeTextMode && activeMode === "source";
  const languageCompletions = useMemo(
    () =>
      languageAssistEnabled
        ? languageServiceCompletions(model.content, language, cursor.offset)
        : [],
    [cursor.offset, language, languageAssistEnabled, model.content],
  );
  const languageHover = useMemo(
    () =>
      languageAssistEnabled
        ? languageServiceHover(model.content, language, cursor.offset)
        : null,
    [cursor.offset, language, languageAssistEnabled, model.content],
  );

  function togglePreviewMode() {
    setMode((current) => (current === "preview" ? "source" : "preview"));
  }

  function openFileFormatDraft() {
    if (largeTextMode) return;
    const baseline = textFileFormatDraft(model);
    setFormatEdit({ baseline, draft: baseline });
  }

  function applyFileFormatDraft() {
    if (!formatEdit || formatIssue || formatConflict || largeTextMode) return;
    onChange({ ...model, ...formatEdit.draft });
    setFormatEdit(null);
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

  function applyLanguageCompletion(label: string) {
    const range = languageServiceCompletionRange(model.content, cursor.offset);
    const nextContent = `${model.content.slice(0, range.start)}${label}${model.content.slice(range.end)}`;
    const nextOffset = range.start + label.length;
    applySourceEdit({
      content: nextContent,
      selectionStart: nextOffset,
      selectionEnd: nextOffset,
    });
    setLanguageAssistOpen(false);
  }

  function updateContent(
    content: string,
    options: { preserveSourceSelections?: boolean } = {},
  ) {
    if (!options.preserveSourceSelections) clearSourceSelections();
    onChange({ ...model, content, trailingNewline: hasTrailingTextNewline(content) });
  }

  function syncLineNumberScroll() {
    if (!sourceRef.current || !lineNumberRef.current) return;
    lineNumberRef.current.scrollTop = sourceRef.current.scrollTop;
    setSourceScrollLeft(sourceRef.current.scrollLeft);
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
    if (largeTextMode) {
      setMode("source");
      setLargeLineRequest((current) => ({
        line,
        token: (current?.token ?? 0) + 1,
      }));
      return;
    }
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
    cancelLargeSearch,
    findNext,
    largeSearchNavigationForQuery,
    largeSearchRange,
    replaceAll,
    replaceNext,
    searchMatches,
    searchError,
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
    if (largeTextMode && commandId !== "goToLine") return false;
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
    } else if (commandId === "outline") {
      setOutlineOpen((current) => !current);
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
      onKeyDown={(event) => {
        if (largeTextMode) return;
        handleTextEditorKeyDown(event, {
          json,
          setTableMode: () => setMode("table"),
          setTreeMode: () => setMode("tree"),
          structured,
          togglePreviewMode,
        });
      }}
    >
      <TextEditorToolbar
        activeMode={activeMode}
        blockCommentsAvailable={Boolean(blockComments)}
        bom={model.bom}
        encoding={model.encoding}
        goToLineOpen={goToLineOpen}
        json={json}
        language={language}
        largeTextMode={largeTextMode}
        lineEnding={model.lineEnding}
        outlineOpen={outlineOpen}
        schemaOpen={schemaOpen}
        searchOpen={searchOpen}
        structured={structured}
        tableAvailable={tableAvailable}
        onDuplicateSelection={duplicateSelection}
        onEnsureFinalNewline={ensureFinalNewline}
        onFormatJson={formatJson}
        onIndentSelection={indentSelection}
        onOpenFileFormat={openFileFormatDraft}
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
      {formatEdit && !largeTextMode && (
        <TextFormatDraftBar
          baseline={formatEdit.baseline}
          draft={formatEdit.draft}
          changedKeys={formatChangedKeys}
          issue={formatIssue}
          conflict={formatConflict}
          impact={formatImpact}
          onChange={(draft) => setFormatEdit({ ...formatEdit, draft })}
          onApply={applyFileFormatDraft}
          onCancel={() => setFormatEdit(null)}
        />
      )}
      {searchOpen && (
        <TextEditorSearchBar
          caseSensitive={caseSensitive}
          largeSearchNavigation={largeSearchNavigationForQuery}
          largeTextMode={largeTextMode}
          regexSearch={regexSearch}
          replaceDraft={replaceDraft}
          searchDraft={searchDraft}
          searchMatches={searchMatches}
          searchError={searchError}
          streamingSearchCount={streamingSearchCountForQuery}
          wholeWord={wholeWord}
          onCaseSensitiveChange={setCaseSensitive}
          onCancelLargeSearch={cancelLargeSearch}
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
      {largeTextMode && (
        <TextEditorLargeFileWarning policy={largeFilePolicy} />
      )}
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
              readOnly={largeTextReadOnly}
              searchRange={largeSearchRange}
              targetLineRequest={largeLineRequest}
              onChangeContent={largeTextReadOnly ? undefined : updateContent}
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
              sourceScrollLeft={sourceScrollLeft}
              sourceScrollTop={sourceScrollTop}
              selectionFragments={sourceSelectionFragments}
              bracketFragments={bracketPairFragments}
              onContentChange={updateContent}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === " ") {
                  event.preventDefault();
                  setLanguageAssistOpen(true);
                  return;
                }
                if (languageAssistOpen && event.key === "Escape") {
                  setLanguageAssistOpen(false);
                  return;
                }
                if (
                  languageAssistOpen &&
                  event.key === "Enter" &&
                  languageCompletions[0]
                ) {
                  event.preventDefault();
                  applyLanguageCompletion(languageCompletions[0].label);
                  return;
                }
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
                  openOutline: () => setOutlineOpen(true),
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
                });
              }}
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
      {languageAssistOpen && languageAssistEnabled && (
        <TextEditorLanguageAssistPanel
          completions={languageCompletions}
          hoverInfo={languageHover}
          onApplyCompletion={(completion) => applyLanguageCompletion(completion.label)}
          onClose={() => setLanguageAssistOpen(false)}
        />
      )}
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
