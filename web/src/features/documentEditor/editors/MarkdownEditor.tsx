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
  insertFootnoteReference,
  isMarkdownHeadingKey,
  isMarkdownUrl,
  lineForOffset,
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
import type {
  MarkdownHeadingLevel,
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
}: {
  filePath: string;
  model: TextModel;
  onChange: (model: TextModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLPreElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
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
  const [cursor, setCursor] = useState({ line: 1, column: 1, selection: 0 });
  const lineCount = Math.max(1, model.content.split("\n").length);
  const outline = markdownOutline(model.content);
  const references = markdownReferences(model.content);
  const tables = markdownTables(model.content);
  const activeTable =
    markdownTableAtLine(model.content, cursor.line) ?? tables[0] ?? null;
  const frontmatter = parseFrontmatter(model.content);
  const frontmatterFields = frontmatter
    ? parseFrontmatterFields(frontmatter.content, frontmatter.marker)
    : [];
  const stats = markdownStats(model.content, outline.length);
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
    () => markdownPreviewComponents(filePath, toggleTaskListAtLine),
    [filePath, toggleTaskListAtLine],
  );

  function updateContent(content: string) {
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
    insertSourceSnippet("```\ncode\n```\n", 4, 8);
  }

  function insertMarkdownTable() {
    insertSourceSnippet("| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n", 2, 10);
    setSidePanel("table");
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
    headers.splice(insertAt, 0, `Column ${insertAt + 1}`);
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
        `${activeTable.headers[columnIndex] ?? "Column"} copy`,
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
    const primary = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === "Tab") {
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
    } else if (primary && event.altKey && key === "o") {
      event.preventDefault();
      setSidePanel((current) => (current === "outline" ? null : "outline"));
    } else if (primary && event.shiftKey && key === "v") {
      event.preventDefault();
      setMode((current) => (current === "preview" ? "source" : "preview"));
    } else if (primary && event.altKey && isMarkdownHeadingKey(key)) {
      event.preventDefault();
      applySourceHeading(Number(key) as MarkdownHeadingLevel);
    }
  }

  function handleSourcePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const textarea = sourceRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;
    const pasted = event.clipboardData.getData("text/plain").trim();
    if (!isMarkdownUrl(pasted)) return;
    event.preventDefault();
    const selected = model.content.slice(textarea.selectionStart, textarea.selectionEnd);
    const next = `${model.content.slice(0, textarea.selectionStart)}[${selected}](${pasted})${model.content.slice(textarea.selectionEnd)}`;
    const start = textarea.selectionStart;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + selected.length + pasted.length + 4);
    });
  }

  function syncLineNumberScroll() {
    if (!sourceRef.current || !lineNumberRef.current) return;
    lineNumberRef.current.scrollTop = sourceRef.current.scrollTop;
  }

  function updateCursor() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const line = lineForOffset(model.content, start);
    setCursor({
      line,
      column: start - offsetForLine(model.content, line) + 1,
      selection: Math.abs(end - start),
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
    focusSourceRange(offsetForLine(model.content, line), offsetForLine(model.content, line));
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
      setMode((current) => (current === "preview" ? "source" : "preview"));
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

  function togglePreview() {
    setMode((current) => (current === "preview" ? "source" : "preview"));
  }

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
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {mode === "preview" ? (
            <article className="chat-markdown h-full min-h-0 overflow-y-auto p-5 text-sm">
              <ReactMarkdown
                components={previewComponents}
                remarkPlugins={[remarkGfm]}
              >
                {model.content}
              </ReactMarkdown>
            </article>
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
                onPaste={handleSourcePaste}
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
        {sidePanel && (
          <MarkdownSidePanel
            panel={sidePanel}
            outline={outline}
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
          />
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
        <span>
          L{cursor.line}:C{cursor.column}
          {cursor.selection > 0 ? ` · ${cursor.selection} selected` : ""}
        </span>
        <span>
          {stats.lines} lines · {stats.words} words · {stats.characters} chars · {stats.headings} headings
        </span>
      </div>
    </div>
  );
}
