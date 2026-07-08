import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EditorCommandRequest } from "../shared/commands";
import {
  createMarkdownFrontmatterActions,
  createMarkdownReferenceActions,
  createMarkdownTableActions,
  handleMarkdownSourceKeyDown,
  handleMarkdownSourcePaste,
  hasTrailingTextNewline,
  insertFootnoteReference,
  insertOrUpdateMarkdownToc,
  lineForOffset,
  markdownPreviewComponents,
  markdownPreviewLineElements,
  MarkdownActiveReferenceBar,
  MarkdownEditorStatusBar,
  MarkdownEditorToolbar,
  MarkdownGoToLineBar,
  MarkdownSearchBar,
  MarkdownSidePanel,
  nextMarkdownFootnoteId,
  nearestMarkdownPreviewLineElement,
  offsetForLine,
  runMarkdownEditorCommand,
  useMarkdownImageActions,
  useMarkdownSearchActions,
  useMarkdownSourceActions,
} from "../markdown";
import type { MarkdownSidePanelKind } from "../markdown";
import {
  activeSourceFoldIds,
  sourceFoldRanges,
  TextSourcePane,
  useTextSourceEditing,
} from "../text";
import type { TextModel } from "../shared/models";
import { useMarkdownEditorDerivedState } from "../markdown/useMarkdownEditorDerivedState";

export function MarkdownRichEditor({
  filePath,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
  onOpenDocument,
}: {
  filePath: string;
  model: TextModel;
  onChange: (model: TextModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
  onOpenDocument?: (path: string) => void;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const pendingPreviewScrollLineRef = useRef<number | null>(null);
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [sidePanel, setSidePanel] = useState<MarkdownSidePanelKind | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [newFrontmatterKey, setNewFrontmatterKey] = useState("");
  const [newFrontmatterValue, setNewFrontmatterValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineDraft, setGoToLineDraft] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [cursor, setCursor] = useState({
    line: 1,
    column: 1,
    selection: 0,
    offset: 0,
  });
  const [foldedSourceIds, setFoldedSourceIds] = useState<Set<string>>(() => new Set());
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const [previewMappedLine, setPreviewMappedLine] = useState<number | null>(null);
  const foldRanges = useMemo(
    () => sourceFoldRanges(model.content, "markdown"),
    [model.content],
  );
  const activeFoldedSourceIds = useMemo(
    () => activeSourceFoldIds(foldedSourceIds, foldRanges),
    [foldRanges, foldedSourceIds],
  );
  const {
    activateRectangularSourceSelection,
    addNextSourceSelection,
    applySourceEdit,
    clearSourceSelections,
    handleSourceMultiCursorKey,
    handleSourcePaste: handleSharedSourcePaste,
    pasteProgress,
    setSourceSelectionRanges,
    sourceSelectionRanges,
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
    visibleSourceLines,
  } = useMarkdownEditorDerivedState({
    activeFoldedSourceIds,
    content: model.content,
    cursor,
    foldRanges,
    matchCase,
    regexSearch,
    searchDraft,
    sourceSelectionRanges,
    wholeWord,
  });
  const toggleTaskListAtLine = useCallback(
    (line: number) => {
      const lines = model.content.split("\n");
      const index = line - 1;
      const current = lines[index];
      if (!current) return;
      const next = current.replace(
        /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)/,
        (_match, prefix: string, checked: string, suffix: string) =>
          `${prefix}${checked.toLowerCase() === "x" ? " " : "x"}${suffix}`,
      );
      if (next === current) return;
      lines[index] = next;
      const content = lines.join("\n");
      onChange({
        ...model,
        content,
        trailingNewline: hasTrailingTextNewline(content),
      });
    },
    [model, onChange],
  );
  const previewComponents = useMemo(
    () =>
      markdownPreviewComponents(
        filePath,
        toggleTaskListAtLine,
        headingAnchors,
        onOpenDocument,
      ),
    [filePath, headingAnchors, onOpenDocument, toggleTaskListAtLine],
  );
  const {
    addMarkdownTableColumn,
    addMarkdownTableRow,
    deleteMarkdownTableColumn,
    deleteMarkdownTableRow,
    duplicateMarkdownTableColumn,
    duplicateMarkdownTableRow,
    moveMarkdownTableColumn,
    moveMarkdownTableRow,
    updateMarkdownTableAlignment,
    updateMarkdownTableCell,
    updateMarkdownTableHeader,
  } = createMarkdownTableActions({
    activeTable,
    content: model.content,
    updateContent,
  });
  const {
    addFrontmatterField,
    deleteFrontmatterField,
    openFrontmatterPanel,
    removeFrontmatter,
    updateFrontmatterBody,
    updateFrontmatterField,
  } = createMarkdownFrontmatterActions({
    content: model.content,
    frontmatter,
    frontmatterFields,
    newFrontmatterKey,
    newFrontmatterValue,
    setMode,
    setNewFrontmatterKey,
    setNewFrontmatterValue,
    setSidePanel,
    updateContent,
  });
  const {
    updateMarkdownReferenceLabel,
    updateMarkdownReferenceTarget,
  } = createMarkdownReferenceActions({
    content: model.content,
    updateContent,
  });
  const {
    applyHeading,
    applySourceHeading,
    focusSourceLine,
    focusSourceRange,
    insertSourceInline,
    insertSourceLink,
    insertSourceSnippet,
    submitGoToLine,
    toggleSourceFold,
    transformSelectedSourceLines,
    wrapSourceSelection,
  } = useMarkdownSourceActions({
    content: model.content,
    foldRanges,
    goToLineDraft,
    lineCount,
    setFoldedSourceIds,
    setGoToLineOpen,
    setMode,
    sourceRef,
    syncLineNumberScroll,
    updateContent,
    updateCursor,
  });
  const { findNext, replaceAll, replaceNext } = useMarkdownSearchActions({
    content: model.content,
    focusSourceRange,
    matchCase,
    regexSearch,
    replaceDraft,
    searchDraft,
    sourceRef,
    updateContent,
    wholeWord,
  });
  const {
    imageAltDraft,
    imageDraft,
    imageInputOpen,
    imageUploadError,
    setImageAltDraft,
    setImageDraft,
    setImageInputOpen,
    submitImage,
    uploadAndInsertImage,
    uploadingImage,
  } = useMarkdownImageActions({
    filePath,
    insertSourceInline,
  });

  function updateContent(
    content: string,
    options: { preserveSourceSelections?: boolean } = {},
  ) {
    if (mode === "source" && activeFoldedSourceIds.size > 0) {
      setFoldedSourceIds(new Set());
      return;
    }
    if (!options.preserveSourceSelections) clearSourceSelections();
    onChange({ ...model, content, trailingNewline: hasTrailingTextNewline(content) });
  }

  function submitLink() {
    const url = linkDraft.trim();
    if (!url) return;
    insertSourceLink(url);
    setLinkInputOpen(false);
    setLinkDraft("");
  }

  function insertTaskList() {
    transformSelectedSourceLines((line) =>
      /^\s*-\s+\[[ xX]\]\s+/.test(line)
        ? line
        : line.replace(/^(\s*)/, "$1- [ ] "),
    );
  }

  function applyBlockquote() {
    transformSelectedSourceLines((line) =>
      /^\s*>\s?/.test(line) ? line : line.replace(/^(\s*)/, "$1> "),
    );
  }

  function applyBulletList() {
    transformSelectedSourceLines((line) =>
      /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
        ? line
        : line.replace(/^(\s*)/, "$1- "),
    );
  }

  function applyNumberedList() {
    transformSelectedSourceLines((line) =>
      /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
        ? line
        : line.replace(/^(\s*)/, (_match, indent: string) => `${indent}1. `),
    );
  }

  function applyInlineCode() {
    wrapSourceSelection("`");
  }

  function insertCodeBlock() {
    insertSourceSnippet("```\n\n```\n", 4, 4);
  }

  function insertMarkdownTable() {
    insertSourceSnippet("|  |  |\n| --- | --- |\n|  |  |\n", 2, 2);
    setSidePanel("table");
  }

  function insertTableOfContents() {
    const textarea = sourceRef.current;
    const offset = textarea?.selectionStart ?? frontmatter?.end ?? 0;
    const next = insertOrUpdateMarkdownToc(model.content, offset);
    if (!next) return;
    updateContent(next.content);
    setMode("source");
    requestAnimationFrame(() => {
      const source = sourceRef.current;
      if (!source) return;
      source.focus();
      source.setSelectionRange(next.selectionStart, next.selectionEnd);
      syncLineNumberScroll();
      updateCursor();
    });
  }

  function openTablePanel() {
    if (activeTable) {
      setSidePanel((current) => (current === "table" ? null : "table"));
      return;
    }
    insertMarkdownTable();
  }

  function insertFootnote() {
    const id = nextMarkdownFootnoteId(model.content);
    const textarea = sourceRef.current;
    if (mode === "source" && textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = insertFootnoteReference(model.content, id, start, end);
      updateContent(next.content);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
        syncLineNumberScroll();
      });
      return;
    }
    setMode("source");
  }

  function togglePreview() {
    if (mode === "source") {
      const line = cursor.line;
      pendingPreviewScrollLineRef.current = line;
      setPreviewMappedLine(line);
      setMode("preview");
      return;
    }
    focusSourceLine(previewMappedLine ?? cursor.line);
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
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (
      sourceSelectionRanges.length > 0 &&
      !sourceSelectionRanges.some(
        (range) => range.start === start && range.end === end,
      )
    ) {
      setSourceSelectionRanges([]);
    }
    const line = lineForOffset(model.content, start);
    setCursor({
      line,
      column: start - offsetForLine(model.content, line) + 1,
      selection: Math.abs(end - start),
      offset: start,
    });
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) =>
      runMarkdownEditorCommand(commandId, cursor.line, {
        applyBlockquote,
        applyBulletList,
        applyHeading,
        applyInlineCode,
        applyNumberedList,
        insertCodeBlock,
        insertMarkdownTable,
        insertTableOfContents,
        insertTaskList,
        setGoToLineDraft,
        setGoToLineOpen,
        setImageInputOpen,
        setLinkInputOpen,
        setSidePanel,
        togglePreview,
        wrapSourceSelection,
      }),
  );

  function updatePreviewScrollLine() {
    const preview = previewRef.current;
    if (!preview) return;
    const blocks = markdownPreviewLineElements(preview);
    if (blocks.length === 0) return;
    const previewTop = preview.getBoundingClientRect().top;
    const current =
      blocks
        .filter((block) => block.getBoundingClientRect().top <= previewTop + 32)
        .at(-1) ?? blocks[0];
    const line = Number(current.dataset.markdownLine);
    if (Number.isFinite(line)) setPreviewMappedLine(line);
  }

  useEffect(() => {
    if (mode !== "preview") return;
    const targetLine = pendingPreviewScrollLineRef.current;
    if (!targetLine) return;
    pendingPreviewScrollLineRef.current = null;
    window.requestAnimationFrame(() => {
      const preview = previewRef.current;
      if (!preview) return;
      const target = nearestMarkdownPreviewLineElement(preview, targetLine);
      target.element?.scrollIntoView({ block: "start" });
      if (target.line !== null) setPreviewMappedLine(target.line);
    });
  }, [mode, model.content]);

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
    <div className="flex h-full min-h-0 flex-col">
      <MarkdownEditorToolbar
        mode={mode}
        sidePanel={sidePanel}
        searchOpen={searchOpen}
        linkInputOpen={linkInputOpen}
        linkDraft={linkDraft}
        imageInputOpen={imageInputOpen}
        imageDraft={imageDraft}
        imageAltDraft={imageAltDraft}
        uploadingImage={uploadingImage}
        imageUploadError={imageUploadError}
        imageFileInputRef={imageFileInputRef}
        onApplyHeading={applyHeading}
        onWrapSelection={wrapSourceSelection}
        onApplyBulletList={applyBulletList}
        onApplyNumberedList={applyNumberedList}
        onInsertTaskList={insertTaskList}
        onApplyBlockquote={applyBlockquote}
        onApplyInlineCode={applyInlineCode}
        onToggleLinkInput={() => setLinkInputOpen((current) => !current)}
        onToggleImageInput={() => setImageInputOpen((current) => !current)}
        onOpenTablePanel={openTablePanel}
        onInsertTableOfContents={insertTableOfContents}
        onInsertFootnote={insertFootnote}
        onToggleOutlinePanel={() =>
          setSidePanel((current) => (current === "outline" ? null : "outline"))
        }
        onOpenFrontmatterPanel={openFrontmatterPanel}
        onToggleReferencesPanel={() =>
          setSidePanel((current) => (current === "references" ? null : "references"))
        }
        onToggleSearch={() => {
          setSearchOpen((current) => !current);
          setMode("source");
        }}
        onOpenGoToLine={() => {
          setGoToLineDraft(String(cursor.line));
          setGoToLineOpen((current) => !current);
          setMode("source");
        }}
        onTogglePreview={togglePreview}
        onSubmitLink={submitLink}
        onLinkDraftChange={setLinkDraft}
        onSubmitImage={submitImage}
        onImageDraftChange={setImageDraft}
        onImageAltDraftChange={setImageAltDraft}
        onUploadImageFile={(file) => void uploadAndInsertImage(file)}
      />
      {searchOpen && (
        <MarkdownSearchBar
          searchDraft={searchDraft}
          replaceDraft={replaceDraft}
          matchCase={matchCase}
          wholeWord={wholeWord}
          regexSearch={regexSearch}
          searchMatches={searchMatches}
          onSearchDraftChange={setSearchDraft}
          onReplaceDraftChange={setReplaceDraft}
          onFindNext={findNext}
          onReplaceNext={replaceNext}
          onReplaceAll={replaceAll}
          onMatchCaseChange={setMatchCase}
          onWholeWordChange={setWholeWord}
          onRegexSearchChange={setRegexSearch}
        />
      )}
      {goToLineOpen && (
        <MarkdownGoToLineBar
          draft={goToLineDraft}
          lineCount={lineCount}
          onDraftChange={setGoToLineDraft}
          onSubmit={submitGoToLine}
          onClose={() => setGoToLineOpen(false)}
        />
      )}
      {mode === "source" && activeReference && (
        <MarkdownActiveReferenceBar
          reference={activeReference}
          onFocusRange={focusSourceRange}
          onLabelChange={updateMarkdownReferenceLabel}
          onTargetChange={updateMarkdownReferenceTarget}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {mode === "preview" ? (
            <article
              ref={previewRef}
              onScroll={updatePreviewScrollLine}
              className="chat-markdown h-full min-h-0 overflow-y-auto p-5 text-sm"
            >
              <ReactMarkdown
                components={previewComponents}
                remarkPlugins={[remarkGfm]}
              >
                {model.content}
              </ReactMarkdown>
            </article>
          ) : (
            <TextSourcePane
              sourceRef={sourceRef}
              lineNumberRef={lineNumberRef}
              sourceDisplayContent={sourceDisplayContent}
              visibleSourceLines={visibleSourceLines}
              foldRangeByStart={foldRangeByStart}
              activeFoldedSourceIds={activeFoldedSourceIds}
              diagnosticsByLine={new Map()}
              selectionFragments={sourceSelectionFragments}
              bracketFragments={bracketPairFragments}
              minimapLines={minimapLines}
              cursorLine={cursor.line}
              sourceScrollTop={sourceScrollTop}
              onContentChange={updateContent}
              onKeyDown={(event) =>
                handleMarkdownSourceKeyDown(event, {
                  folded: activeFoldedSourceIds.size > 0,
                  content: model.content,
                  cursorLine: cursor.line,
                  addNextSourceSelection,
                  activateRectangularSourceSelection,
                  applyBlockquote,
                  applyInlineCode,
                  applySourceEdit,
                  applySourceHeading,
                  handleSourceMultiCursorKey,
                  insertCodeBlock,
                  insertMarkdownTable,
                  insertTableOfContents,
                  insertTaskList,
                  openGoToLine: (line) => {
                    setGoToLineDraft(String(line));
                    setGoToLineOpen(true);
                  },
                  openImageInput: () => setImageInputOpen(true),
                  openSearch: () => setSearchOpen(true),
                  toggleOutlinePanel: () =>
                    setSidePanel((current) =>
                      current === "outline" ? null : "outline",
                    ),
                  togglePreview,
                  transformSelectedSourceLines,
                  unfoldAll: () => setFoldedSourceIds(new Set()),
                  updateCursor,
                  wrapSourceSelection,
                })
              }
              onPaste={(event) =>
                handleMarkdownSourcePaste(event, {
                  content: model.content,
                  handleSharedSourcePaste,
                  sourceRef,
                  updateContent,
                })
              }
              onCursorUpdate={updateCursor}
              onScroll={syncLineNumberScroll}
              onFocusLine={focusSourceLine}
              onToggleFold={toggleSourceFold}
            />
          )}
        </div>
        {sidePanel && (
          <MarkdownSidePanel
            panel={sidePanel}
            outline={outline}
            headingAnchors={headingAnchors}
            references={references}
            table={activeTable}
            frontmatter={frontmatter}
            frontmatterFields={frontmatterFields}
            newFrontmatterKey={newFrontmatterKey}
            newFrontmatterValue={newFrontmatterValue}
            onClose={() => setSidePanel(null)}
            onFocusLine={focusSourceLine}
            onFocusRange={focusSourceRange}
            onCreateTable={insertMarkdownTable}
            onTableHeaderChange={updateMarkdownTableHeader}
            onTableAlignmentChange={updateMarkdownTableAlignment}
            onTableCellChange={updateMarkdownTableCell}
            onTableAddRow={addMarkdownTableRow}
            onTableDuplicateRow={duplicateMarkdownTableRow}
            onTableMoveRow={moveMarkdownTableRow}
            onTableDeleteRow={deleteMarkdownTableRow}
            onTableAddColumn={addMarkdownTableColumn}
            onTableDuplicateColumn={duplicateMarkdownTableColumn}
            onTableMoveColumn={moveMarkdownTableColumn}
            onTableDeleteColumn={deleteMarkdownTableColumn}
            onFrontmatterBodyChange={updateFrontmatterBody}
            onFrontmatterFieldChange={updateFrontmatterField}
            onFrontmatterFieldDelete={deleteFrontmatterField}
            onFrontmatterFieldAdd={addFrontmatterField}
            onFrontmatterRemove={removeFrontmatter}
            onFrontmatterCreate={openFrontmatterPanel}
            onNewFrontmatterKeyChange={setNewFrontmatterKey}
            onNewFrontmatterValueChange={setNewFrontmatterValue}
            onReferenceLabelChange={updateMarkdownReferenceLabel}
            onReferenceTargetChange={updateMarkdownReferenceTarget}
          />
        )}
      </div>
      <MarkdownEditorStatusBar
        cursor={cursor}
        pasteProgress={pasteProgress}
        sourceSelectionCount={sourceSelectionRanges.length}
        stats={stats}
      />
    </div>
  );
}
