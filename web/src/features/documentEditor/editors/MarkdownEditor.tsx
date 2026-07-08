import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uploadDriveFiles } from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";
import type { EditorCommandRequest } from "../commands";
import { MarkdownEditorToolbar } from "../markdownEditorToolbar";
import { MarkdownGoToLineBar, MarkdownSearchBar } from "../markdownSearchBars";
import {
  buildMarkdownSearchRegex,
  countMarkdownSearchMatches,
  formatFrontmatterField,
  hasTrailingTextNewline,
  indentMarkdownLine,
  insertOrUpdateMarkdownToc,
  insertFootnoteReference,
  isMarkdownHeadingKey,
  isMarkdownUrl,
  lineForOffset,
  markdownHeadingAnchors,
  markdownTableAtLine,
  markdownTables,
  markdownOutline,
  markdownReferences,
  markdownStats,
  nextMarkdownFootnoteId,
  nextMarkdownSearchRange,
  offsetForLine,
  outdentMarkdownLine,
  parseFrontmatter,
  parseFrontmatterFields,
  replaceFrontmatterBody,
  replaceMarkdownTable,
} from "../markdownEditorUtils";
import { markdownPreviewComponents, markdownRelativeFileReference } from "../markdownPreview";
import { MarkdownSidePanel } from "../markdownSidePanel";
import type { MarkdownSidePanelKind } from "../markdownSidePanel";
import {
  activeSourceFoldIds,
  autoPairSource,
  isPotentialSourceEditKey,
  sourceBracketPairFragments,
  sourceDisplayText,
  sourceFoldRanges,
  sourceMinimapLines,
  sourceSelectionLineFragments,
  sourceVisibleLines,
} from "../textSourceUtils";
import type { SourceFoldRange } from "../textSourceUtils";
import { TextSourcePane } from "../textSourcePane";
import { useTextSourceEditing } from "../useTextSourceEditing";
import type {
  MarkdownHeadingLevel,
  MarkdownReference,
  MarkdownTableAlignment,
  MarkdownTableModel,
} from "../markdownEditorUtils";
import type { TextModel } from "../models";

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
  const [imageDraft, setImageDraft] = useState("");
  const [imageAltDraft, setImageAltDraft] = useState("");
  const [imageInputOpen, setImageInputOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
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
  const lineCount = Math.max(1, model.content.split("\n").length);
  const outline = markdownOutline(model.content);
  const headingAnchors = useMemo(() => markdownHeadingAnchors(outline), [outline]);
  const references = markdownReferences(model.content);
  const activeReference =
    references.find(
      (reference) =>
        cursor.offset >= reference.start &&
        cursor.offset <= reference.end &&
        (reference.labelStart !== undefined ||
          reference.targetStart !== undefined),
    ) ?? null;
  const tables = markdownTables(model.content);
  const activeTable =
    markdownTableAtLine(model.content, cursor.line) ?? tables[0] ?? null;
  const frontmatter = parseFrontmatter(model.content);
  const frontmatterFields = frontmatter
    ? parseFrontmatterFields(frontmatter.content, frontmatter.marker)
    : [];
  const stats = markdownStats(model.content, outline.length);
  const foldRanges = sourceFoldRanges(model.content, "markdown");
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
  const minimapLines = useMemo(
    () => sourceMinimapLines(model.content),
    [model.content],
  );
  const sourceSelectionFragments = useMemo(
    () => sourceSelectionLineFragments(model.content, sourceSelectionRanges),
    [model.content, sourceSelectionRanges],
  );
  const bracketPairFragments = useMemo(
    () => sourceBracketPairFragments(model.content),
    [model.content],
  );
  const searchMatches = countMarkdownSearchMatches(model.content, searchDraft, {
    matchCase,
    wholeWord,
    regexSearch,
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

  function submitImage() {
    const src = imageDraft.trim();
    if (!src) return;
    insertImageReference(src, imageAltDraft.trim());
  }

  function insertImageReference(src: string, altText: string) {
    insertSourceInline(`![${altText}](${src})`);
    setImageInputOpen(false);
    setImageDraft("");
    setImageAltDraft("");
    setImageUploadError(null);
  }

  async function uploadAndInsertImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const uploaded = await uploadDriveFiles(parentPath(filePath), [file]);
      const entry = uploaded.files[0];
      if (!entry) return;
      insertImageReference(
        markdownRelativeFileReference(filePath, entry.path, entry.name),
        imageAltDraft.trim() || file.name.replace(/\.[^.]+$/, ""),
      );
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
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

  function updateMarkdownTable(nextTable: MarkdownTableModel) {
    if (!activeTable) return;
    updateContent(replaceMarkdownTable(model.content, activeTable, nextTable));
  }

  function updateMarkdownTableHeader(columnIndex: number, value: string) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      headers: activeTable.headers.map((header, index) =>
        index === columnIndex ? value : header,
      ),
    });
  }

  function updateMarkdownTableAlignment(
    columnIndex: number,
    alignment: MarkdownTableAlignment,
  ) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      alignments: activeTable.alignments.map((item, index) =>
        index === columnIndex ? alignment : item,
      ),
    });
  }

  function updateMarkdownTableCell(
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: activeTable.rows.map((row, index) =>
        index === rowIndex
          ? row.map((cell, currentColumn) =>
              currentColumn === columnIndex ? value : cell,
            )
          : row,
      ),
    });
  }

  function addMarkdownTableRow(afterRowIndex?: number) {
    if (!activeTable) return;
    const insertAt =
      afterRowIndex === undefined
        ? activeTable.rows.length
        : Math.min(activeTable.rows.length, afterRowIndex + 1);
    const rows = activeTable.rows.map((row) => [...row]);
    rows.splice(insertAt, 0, Array(activeTable.headers.length).fill(""));
    updateMarkdownTable({ ...activeTable, rows });
  }

  function duplicateMarkdownTableRow(rowIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: [
        ...activeTable.rows.slice(0, rowIndex + 1),
        [...(activeTable.rows[rowIndex] ?? [])],
        ...activeTable.rows.slice(rowIndex + 1),
      ],
    });
  }

  function moveMarkdownTableRow(rowIndex: number, direction: -1 | 1) {
    if (!activeTable) return;
    const nextIndex = rowIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeTable.rows.length) return;
    const rows = activeTable.rows.map((row) => [...row]);
    const [moved] = rows.splice(rowIndex, 1);
    rows.splice(nextIndex, 0, moved);
    updateMarkdownTable({ ...activeTable, rows });
  }

  function deleteMarkdownTableRow(rowIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: activeTable.rows.filter((_, index) => index !== rowIndex),
    });
  }

  function addMarkdownTableColumn(afterColumnIndex?: number) {
    if (!activeTable) return;
    const insertAt =
      afterColumnIndex === undefined
        ? activeTable.headers.length
        : Math.min(activeTable.headers.length, afterColumnIndex + 1);
    const headers = [...activeTable.headers];
    const alignments = [...activeTable.alignments];
    headers.splice(insertAt, 0, "");
    alignments.splice(insertAt, 0, "default");
    updateMarkdownTable({
      ...activeTable,
      headers,
      alignments,
      rows: activeTable.rows.map((row) => {
        const next = [...row];
        next.splice(insertAt, 0, "");
        return next;
      }),
    });
  }

  function duplicateMarkdownTableColumn(columnIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      headers: [
        ...activeTable.headers.slice(0, columnIndex + 1),
        activeTable.headers[columnIndex] ?? "",
        ...activeTable.headers.slice(columnIndex + 1),
      ],
      alignments: [
        ...activeTable.alignments.slice(0, columnIndex + 1),
        activeTable.alignments[columnIndex] ?? "default",
        ...activeTable.alignments.slice(columnIndex + 1),
      ],
      rows: activeTable.rows.map((row) => [
        ...row.slice(0, columnIndex + 1),
        row[columnIndex] ?? "",
        ...row.slice(columnIndex + 1),
      ]),
    });
  }

  function moveMarkdownTableColumn(columnIndex: number, direction: -1 | 1) {
    if (!activeTable) return;
    const nextIndex = columnIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeTable.headers.length) return;
    const move = <T,>(items: T[]) => {
      const next = [...items];
      const [moved] = next.splice(columnIndex, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    };
    updateMarkdownTable({
      ...activeTable,
      headers: move(activeTable.headers),
      alignments: move(activeTable.alignments),
      rows: activeTable.rows.map((row) => move(row)),
    });
  }

  function deleteMarkdownTableColumn(columnIndex: number) {
    if (!activeTable || activeTable.headers.length <= 1) return;
    updateMarkdownTable({
      ...activeTable,
      headers: activeTable.headers.filter((_, index) => index !== columnIndex),
      alignments: activeTable.alignments.filter((_, index) => index !== columnIndex),
      rows: activeTable.rows.map((row) =>
        row.filter((_, index) => index !== columnIndex),
      ),
    });
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

  function insertSourceSnippet(
    snippet: string,
    selectStartOffset = snippet.length,
    selectEndOffset = selectStartOffset,
  ) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = model.content.slice(0, start);
    const after = model.content.slice(end);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !snippet.endsWith("\n") ? "\n" : "";
    const inserted = `${prefix}${snippet}${suffix}`;
    const next = `${before}${inserted}${after}`;
    updateContent(next);
    const selectionStart = start + prefix.length + selectStartOffset;
    const selectionEnd = start + prefix.length + selectEndOffset;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      syncLineNumberScroll();
    });
  }

  function insertSourceInline(text: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}${text}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${model.content.slice(0, start)}${text}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
      syncLineNumberScroll();
    });
  }

  function replaceMarkdownReferenceRange(start: number, end: number, value: string) {
    const safeStart = Math.max(0, Math.min(model.content.length, start));
    const safeEnd = Math.max(safeStart, Math.min(model.content.length, end));
    const content = `${model.content.slice(0, safeStart)}${value}${model.content.slice(safeEnd)}`;
    updateContent(content);
  }

  function updateMarkdownReferenceLabel(
    reference: MarkdownReference,
    value: string,
  ) {
    if (reference.labelStart === undefined || reference.labelEnd === undefined) {
      return;
    }
    replaceMarkdownReferenceRange(
      reference.labelStart,
      reference.labelEnd,
      reference.kind === "footnote"
        ? `[^${normalizeMarkdownFootnoteId(value)}]`
        : value,
    );
  }

  function updateMarkdownReferenceTarget(
    reference: MarkdownReference,
    value: string,
  ) {
    if (reference.targetStart === undefined || reference.targetEnd === undefined) {
      return;
    }
    replaceMarkdownReferenceRange(
      reference.targetStart,
      reference.targetEnd,
      reference.kind === "footnote" ? formatMarkdownFootnoteBody(value) : value,
    );
  }

  function insertSourceLink(url: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}[${url}](${url})`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = model.content.slice(start, end);
    const label = selected || url;
    const link = `[${label}](${url})`;
    const next = `${model.content.slice(0, start)}${link}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1 + label.length);
      syncLineNumberScroll();
    });
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
      transformSelectedSourceLines(event.shiftKey ? outdentMarkdownLine : indentMarkdownLine);
    } else if (primary && key === "b") {
      event.preventDefault();
      wrapSourceSelection("**");
    } else if (primary && key === "f") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "h") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "g") {
      event.preventDefault();
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else if (primary && event.shiftKey && key === "i") {
      event.preventDefault();
      setImageInputOpen(true);
    } else if (primary && key === "i") {
      event.preventDefault();
      wrapSourceSelection("*");
    } else if (primary && key === "k") {
      event.preventDefault();
      wrapSourceSelection("[", "](url)");
    } else if (primary && event.shiftKey && key === "9") {
      event.preventDefault();
      insertTaskList();
    } else if (primary && event.shiftKey && (key === "." || key === ">")) {
      event.preventDefault();
      applyBlockquote();
    } else if (primary && key === "e") {
      event.preventDefault();
      applyInlineCode();
    } else if (primary && event.altKey && key === "c") {
      event.preventDefault();
      insertCodeBlock();
    } else if (primary && event.altKey && key === "t") {
      event.preventDefault();
      insertMarkdownTable();
    } else if (primary && event.altKey && key === "m") {
      event.preventDefault();
      insertTableOfContents();
    } else if (primary && event.altKey && key === "o") {
      event.preventDefault();
      setSidePanel((current) => (current === "outline" ? null : "outline"));
    } else if (primary && event.shiftKey && key === "v") {
      event.preventDefault();
      togglePreview();
    } else if (primary && event.altKey && isMarkdownHeadingKey(key)) {
      event.preventDefault();
      applySourceHeading(Number(key) as MarkdownHeadingLevel);
    } else if (autoPairSource(event, model.content, "code", applySourceEdit)) {
      event.preventDefault();
      requestAnimationFrame(updateCursor);
    }
  }

  function handleSourcePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    handleSharedSourcePaste(event, ({ pastedText, selectionStart, selectionEnd }) => {
      if (selectionStart !== selectionEnd && isMarkdownUrl(pastedText.trim())) {
        event.preventDefault();
        const pasted = pastedText.trim();
        const selected = model.content.slice(selectionStart, selectionEnd);
        const next = `${model.content.slice(0, selectionStart)}[${selected}](${pasted})${model.content.slice(selectionEnd)}`;
        updateContent(next);
        requestAnimationFrame(() => {
          const textarea = sourceRef.current;
          if (!textarea) return;
          textarea.focus();
          textarea.setSelectionRange(
            selectionStart,
            selectionStart + selected.length + pasted.length + 4,
          );
        });
        return true;
      }
      return false;
    });
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

  function wrapSourceSelection(before: string, after = before) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${model.content.slice(0, start)}${before}${model.content.slice(start, end)}${after}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function applyHeading(level: MarkdownHeadingLevel) {
    applySourceHeading(level);
  }

  function applySourceHeading(level: MarkdownHeadingLevel) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const lineStart = model.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = model.content.indexOf("\n", start);
    const end = lineEnd === -1 ? model.content.length : lineEnd;
    const line = model.content.slice(lineStart, end);
    const prefix = `${"#".repeat(level)} `;
    const nextLine = line.replace(/^#{1,6}\s+/, "");
    const next = `${model.content.slice(0, lineStart)}${prefix}${nextLine}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length + nextLine.length);
      updateCursor();
    });
  }

  function transformSelectedSourceLines(transform: (line: string) => string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = model.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextNewline = model.content.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? model.content.length : nextNewline;
    const block = model.content.slice(lineStart, lineEnd);
    const nextBlock = block.split("\n").map(transform).join("\n");
    const next = `${model.content.slice(0, lineStart)}${nextBlock}${model.content.slice(lineEnd)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + nextBlock.length);
      updateCursor();
    });
  }

  function focusSourceLine(line: number) {
    unfoldSourceLine(line);
    focusSourceRange(offsetForLine(model.content, line), offsetForLine(model.content, line));
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

  function focusSourceRange(start: number, end: number) {
    setMode("source");
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const line = lineForOffset(model.content, start);
      textarea.scrollTop = Math.max(0, (line - 4) * 24);
      syncLineNumberScroll();
      updateCursor();
    });
  }

  function submitGoToLine() {
    const line = Math.max(1, Math.min(lineCount, Math.floor(Number(goToLineDraft))));
    if (!Number.isFinite(line)) return;
    focusSourceLine(line);
    setGoToLineOpen(false);
  }

  function findNext() {
    const start = sourceRef.current?.selectionEnd ?? 0;
    const range = nextMarkdownSearchRange(model.content, searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
      start,
    });
    if (range) focusSourceRange(range.start, range.end);
  }

  function replaceNext() {
    const textarea = sourceRef.current;
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
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
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    updateContent(model.content.replace(regex, replaceDraft));
  }

  function openFrontmatterPanel() {
    if (!frontmatter) {
      const prefix = model.content.length > 0 ? "\n\n" : "";
      updateContent(`---\n---\n${prefix}${model.content}`);
    }
    setSidePanel("frontmatter");
    setMode("source");
  }

  function updateFrontmatterBody(body: string) {
    const next = replaceFrontmatterBody(model.content, body);
    if (next) updateContent(next);
  }

  function updateFrontmatterField(lineIndex: number, key: string, value: string) {
    if (!frontmatter) return;
    const lines = frontmatter.content.split(/\r?\n/);
    const cleanKey = key.trim();
    if (!cleanKey) return;
    lines[lineIndex] = formatFrontmatterField(cleanKey, value, frontmatter.marker);
    updateFrontmatterBody(lines.join("\n"));
  }

  function deleteFrontmatterField(lineIndex: number) {
    if (!frontmatter) return;
    const lines = frontmatter.content.split(/\r?\n/);
    lines.splice(lineIndex, 1);
    updateFrontmatterBody(lines.join("\n"));
  }

  function addFrontmatterField() {
    if (!frontmatter) return;
    const cleanKey = newFrontmatterKey.trim();
    if (!cleanKey) return;
    const lines = frontmatter.content.split(/\r?\n/).filter((line) => line.length > 0);
    lines.push(formatFrontmatterField(cleanKey, newFrontmatterValue, frontmatter.marker));
    updateFrontmatterBody(lines.join("\n"));
    setNewFrontmatterKey("");
    setNewFrontmatterValue("");
  }

  function removeFrontmatter() {
    if (!frontmatter) return;
    updateContent(`${model.content.slice(0, frontmatter.start)}${model.content.slice(frontmatter.end)}`.replace(/^\s*\n/, ""));
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (commandId === "bold") {
      wrapSourceSelection("**");
    } else if (commandId === "italic") {
      wrapSourceSelection("*");
    } else if (commandId === "strikethrough") {
      wrapSourceSelection("~~");
    } else if (commandId === "link") {
      setLinkInputOpen(true);
    } else if (commandId === "heading1") {
      applyHeading(1);
    } else if (commandId === "heading2") {
      applyHeading(2);
    } else if (commandId === "heading3") {
      applyHeading(3);
    } else if (commandId === "heading4") {
      applyHeading(4);
    } else if (commandId === "heading5") {
      applyHeading(5);
    } else if (commandId === "heading6") {
      applyHeading(6);
    } else if (commandId === "togglePreview") {
      togglePreview();
    } else if (commandId === "bulletList") {
      transformSelectedSourceLines((line) =>
        /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
          ? line
          : line.replace(/^(\s*)/, "$1- "),
      );
    } else if (commandId === "numberedList") {
      transformSelectedSourceLines((line) =>
        /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
          ? line
          : line.replace(/^(\s*)/, (_match, indent: string) => `${indent}1. `),
      );
    } else if (commandId === "taskList") {
      insertTaskList();
    } else if (commandId === "blockquote") {
      applyBlockquote();
    } else if (commandId === "inlineCode") {
      applyInlineCode();
    } else if (commandId === "codeBlock") {
      insertCodeBlock();
    } else if (commandId === "image") {
      setImageInputOpen(true);
    } else if (commandId === "insertTable") {
      insertMarkdownTable();
    } else if (commandId === "tableOfContents") {
      insertTableOfContents();
    } else if (commandId === "outline") {
      setSidePanel((current) => (current === "outline" ? null : "outline"));
    } else if (commandId === "goToLine") {
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else {
      return false;
    }
    return true;
    },
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
        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
          <span className="mb-2 rounded border border-[var(--border)] px-1.5 py-0.5 uppercase text-[10px] text-[var(--text-faint)]">
            {activeReference.kind}
          </span>
          {activeReference.labelStart !== undefined &&
            activeReference.labelEnd !== undefined && (
              <label className="grid min-w-40 gap-1">
                <span className="uppercase tracking-wide">
                  {activeReference.kind === "image"
                    ? "Alt"
                    : activeReference.kind === "footnote"
                      ? "Footnote"
                      : "Label"}
                </span>
                <input
                  value={markdownReferenceInputLabel(activeReference)}
                  onChange={(event) =>
                    updateMarkdownReferenceLabel(
                      activeReference,
                      event.currentTarget.value,
                    )
                  }
                  className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </label>
            )}
          {activeReference.targetStart !== undefined &&
            activeReference.targetEnd !== undefined && (
              <label className="grid min-w-56 flex-1 gap-1">
                <span className="uppercase tracking-wide">
                  {activeReference.kind === "footnote" ? "Body" : "Target"}
                </span>
                <input
                  value={singleLineMarkdownReferenceTarget(activeReference)}
                  onChange={(event) =>
                    updateMarkdownReferenceTarget(
                      activeReference,
                      event.currentTarget.value,
                    )
                  }
                  className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </label>
            )}
          <button
            type="button"
            onClick={() => focusSourceRange(activeReference.start, activeReference.end)}
            className="mb-0.5 rounded border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            Focus
          </button>
        </div>
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
              onKeyDown={handleSourceKeyDown}
              onPaste={handleSourcePaste}
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
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
        <span>
          L{cursor.line}:C{cursor.column}
          {cursor.selection > 0 ? ` · ${cursor.selection} selected` : ""}
          {sourceSelectionRanges.length > 1
            ? ` · ${sourceSelectionRanges.length} cursors`
            : ""}
          {pasteProgress
            ? ` · pasting ${Math.round((pasteProgress.processed / Math.max(1, pasteProgress.total)) * 100)}%`
            : ""}
        </span>
        <span>
          {stats.lines} lines · {stats.words} words · {stats.characters} chars · {stats.headings} headings
        </span>
      </div>
    </div>
  );
}

function normalizeMarkdownFootnoteId(value: string) {
  return (
    value
      .trim()
      .replace(/^\[\^/, "")
      .replace(/\]$/, "")
      .replace(/\s+/g, "-") || "note"
  );
}

function formatMarkdownFootnoteBody(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line, index) => {
      if (index === 0 || !line.trim()) return line;
      return `    ${line.replace(/^\s+/, "")}`;
    })
    .join("\n");
}

function markdownReferenceInputLabel(reference: MarkdownReference) {
  if (reference.kind === "footnote") {
    return reference.label.replace(/^\[\^/, "").replace(/\]$/, "");
  }
  return reference.label;
}

function singleLineMarkdownReferenceTarget(reference: MarkdownReference) {
  return (reference.target ?? "").replace(/\n\s*/g, " ");
}

function markdownPreviewLineElements(preview: HTMLElement) {
  return Array.from(
    preview.querySelectorAll<HTMLElement>("[data-markdown-line]"),
  )
    .filter((element) => Number.isFinite(Number(element.dataset.markdownLine)))
    .sort(
      (left, right) =>
        Number(left.dataset.markdownLine) - Number(right.dataset.markdownLine),
    );
}

function nearestMarkdownPreviewLineElement(preview: HTMLElement, targetLine: number) {
  const elements = markdownPreviewLineElements(preview);
  let previous: HTMLElement | null = null;
  let next: HTMLElement | null = null;
  for (const element of elements) {
    const line = Number(element.dataset.markdownLine);
    if (line === targetLine) {
      return { element, line };
    }
    if (line < targetLine) {
      previous = element;
      continue;
    }
    next = element;
    break;
  }
  const element = previous ?? next ?? elements[0] ?? null;
  const line = element ? Number(element.dataset.markdownLine) : null;
  return { element, line: Number.isFinite(line) ? line : null };
}
