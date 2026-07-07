import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  FileText,
  Heading1,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Palette,
  Plus,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Underline,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import {
  DOCX_PAGE_PRESETS,
  allocateDocxBlockId,
  docxPagePresetValue,
  docxPageStyle,
  focusDocxBlock,
  headingFontSize,
  isDocxTextBlock,
  nextDocxBlockId,
  nextDocxNoteId,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRowHeights,
  pickDocxFormatting,
  pointsToTwips,
  readImageDisplaySize,
  sectionBreakLabel,
  tableColumnCount,
  textOffsetWithin,
  twipsToCssPixels,
  twipsToPoints,
} from "../docxEditorUtils";
import type { DocxFormatClipboard } from "../docxEditorUtils";
import { builtInFontFamilies } from "../fonts";
import type {
  DocxBlock,
  DocxComment,
  DocxModel,
  DocxPageSettings,
} from "../models";
import { FontFamilySelect, ToolbarButton } from "../shared";
import {
  DocxImageBlock,
  DocxMarginInput,
  DocxRuler,
  DocxTableBlock,
  DocxTextPartsPanel,
} from "../docxEditorBlocks";
import {
  addDocxTableColumn,
  addDocxTableRow,
  deleteDocxTableColumn,
  deleteDocxTableRow,
  duplicateDocxTableColumn,
  duplicateDocxTableRow,
  insertDocxTableColumn,
  insertDocxTableRow,
  moveDocxTableColumn,
  moveDocxTableRow,
  pasteDocxTableCells,
  resizeDocxTableColumn,
  resizeDocxTableRow,
  updateDocxTableCell,
} from "../docxTableOperations";

export function DocxEditor({
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  model: DocxModel;
  onChange: (model: DocxModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const { t } = useTranslation();
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    model.blocks[0]?.id ?? null,
  );
  const [textPartsOpen, setTextPartsOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [formatClipboard, setFormatClipboard] =
    useState<DocxFormatClipboard | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const activeBlock =
    model.blocks.find((block) => block.id === activeBlockId) ?? model.blocks[0];
  const page = model.page;
  const hasDocumentParts = Boolean(
    model.headers?.length ||
      model.footers?.length ||
      model.comments?.length ||
      model.footnotes?.length ||
      model.endnotes?.length,
  );

  function updatePage(patch: Partial<DocxPageSettings>) {
    onChange({ ...model, page: { ...model.page, ...patch } });
  }

  function updatePageOrientation(orientation: "portrait" | "landscape") {
    const current = model.page;
    const shouldSwap =
      current?.width !== undefined &&
      current.height !== undefined &&
      ((orientation === "landscape" && current.width < current.height) ||
        (orientation === "portrait" && current.width > current.height));
    updatePage({
      orientation,
      width: shouldSwap ? current?.height : current?.width,
      height: shouldSwap ? current?.width : current?.height,
    });
  }

  function updatePagePreset(value: string) {
    const preset = DOCX_PAGE_PRESETS.find((item) => item.value === value);
    if (!preset) return;
    const orientation = page?.orientation ?? "portrait";
    updatePage({
      width: orientation === "landscape" ? preset.height : preset.width,
      height: orientation === "landscape" ? preset.width : preset.height,
    });
  }

  function updateBlock(index: number, patch: Partial<DocxBlock>) {
    onChange({
      ...model,
      blocks: model.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } : block,
      ),
    });
  }

  function updateActive(patch: Partial<DocxBlock>) {
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    if (index >= 0) updateBlock(index, patch);
  }

  function openLinkEditor() {
    setLinkDraft(activeBlock?.target ?? "");
    setLinkInputOpen(true);
  }

  function applyLinkDraft() {
    const target = linkDraft.trim();
    updateActive({
      target: target || undefined,
      relationshipId: target ? activeBlock?.relationshipId : undefined,
    });
    setLinkInputOpen(false);
  }

  function applyNormalStyle() {
    if (!isDocxTextBlock(activeBlock)) return;
    updateActive({
      type: "paragraph",
      headingLevel: undefined,
      fontSize: activeBlock.fontSize ?? "14",
      listKind: undefined,
    });
  }

  function copyActiveFormatting() {
    if (!isDocxTextBlock(activeBlock)) return;
    setFormatClipboard(pickDocxFormatting(activeBlock));
  }

  function pasteActiveFormatting() {
    if (!formatClipboard || !isDocxTextBlock(activeBlock)) return;
    updateActive(formatClipboard);
  }

  function insertNoteReference(kind: "footnote" | "endnote", blockIndex?: number) {
    const targetIndex =
      blockIndex ??
      model.blocks.findIndex((block) => block.id === activeBlock?.id);
    const block = model.blocks[targetIndex];
    if (!isDocxTextBlock(block)) return;
    const noteKey = kind === "footnote" ? "footnotes" : "endnotes";
    const blockKey = kind === "footnote" ? "footnoteId" : "endnoteId";
    const notes = model[noteKey] ?? [];
    const noteId = block[blockKey] ?? nextDocxNoteId(notes, model.blocks, blockKey);
    const noteExists = notes.some((note) => note.id === noteId);
    onChange({
      ...model,
      blocks: model.blocks.map((item, index) =>
        index === targetIndex ? { ...item, [blockKey]: noteId } : item,
      ),
      [noteKey]: noteExists ? notes : [...notes, { id: noteId, kind, text: "" }],
    });
    setActiveBlockId(block.id);
    setTextPartsOpen(true);
  }

  function replaceBlocks(blocks: DocxBlock[], nextActiveId?: string) {
    onChange({ ...model, blocks });
    if (nextActiveId !== undefined) {
      setActiveBlockId(nextActiveId);
      requestAnimationFrame(() => focusDocxBlock(nextActiveId));
    }
  }

  function insertBlockAfterActive(block: DocxBlock) {
    const activeIndex = model.blocks.findIndex((item) => item.id === activeBlock?.id);
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : model.blocks.length;
    replaceBlocks(
      [
        ...model.blocks.slice(0, insertAt),
        block,
        ...model.blocks.slice(insertAt),
      ],
      block.id,
    );
  }

  function addBlock(
    type: Exclude<DocxBlock["type"], "image" | "pageBreak" | "sectionBreak"> = "paragraph",
  ) {
    const next = {
      id: nextDocxBlockId(model.blocks, type === "table" ? "tbl" : "p"),
      type,
      text: "",
      headingLevel: type === "heading" ? 1 : undefined,
      rows: type === "table" ? [["", ""], ["", ""]] : undefined,
      tableColumnWidths:
        type === "table" ? normalizeDocxTableColumnWidths(undefined, 2) : undefined,
      tableRowHeights:
        type === "table" ? normalizeDocxTableRowHeights(undefined, 2) : undefined,
      fontFamily: activeBlock?.fontFamily ?? builtInFontFamilies[0],
      fontSize: type === "heading" ? headingFontSize(1) : "14",
      align: "left" as const,
      indentLeft: activeBlock?.indentLeft,
      spacingBefore: activeBlock?.spacingBefore,
      spacingAfter: activeBlock?.spacingAfter,
      lineSpacing: activeBlock?.lineSpacing,
      listKind: activeBlock?.type === "table" ? undefined : activeBlock?.listKind,
    };
    onChange({ ...model, blocks: [...model.blocks, next] });
    setActiveBlockId(next.id);
  }

  function insertPageBreak() {
    insertBlockAfterActive({
      id: nextDocxBlockId(model.blocks, "br"),
      type: "pageBreak",
      text: "",
    });
  }

  function insertSectionBreak() {
    insertBlockAfterActive({
      id: nextDocxBlockId(model.blocks, "sect"),
      type: "sectionBreak",
      text: "",
      breakKind: "nextPage",
    });
  }

  function insertImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      readImageDisplaySize(dataUrl).then(({ width, height }) => {
        insertBlockAfterActive({
          id: nextDocxBlockId(model.blocks, "img"),
          type: "image",
          text: "",
          dataUrl,
          mimeType: file.type,
          altText: file.name,
          width,
          height,
        });
      });
    };
    reader.readAsDataURL(file);
  }

  function deleteActiveBlock() {
    if (!activeBlock) return;
    const nextBlocks = model.blocks.filter((block) => block.id !== activeBlock.id);
    onChange({ ...model, blocks: nextBlocks });
    setActiveBlockId(nextBlocks[0]?.id ?? null);
  }

  function moveActiveBlock(direction: -1 | 1) {
    if (!activeBlock) return;
    const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= model.blocks.length) return;
    const nextBlocks = [...model.blocks];
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(nextIndex, 0, moved);
    onChange({ ...model, blocks: nextBlocks });
  }

  function handleBlockShortcut(
    event: ReactKeyboardEvent<HTMLDivElement>,
    index: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (!primary) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      updateBlock(index, { bold: !model.blocks[index]?.bold });
    } else if (key === "i") {
      event.preventDefault();
      updateBlock(index, { italic: !model.blocks[index]?.italic });
    } else if (key === "u") {
      event.preventDefault();
      updateBlock(index, { underline: !model.blocks[index]?.underline });
    } else if (event.shiftKey && key === "x") {
      event.preventDefault();
      updateBlock(index, {
        strikethrough: !model.blocks[index]?.strikethrough,
      });
    } else if (event.altKey && /^[1-6]$/.test(key)) {
      event.preventDefault();
      const headingLevel = Number(key);
      updateBlock(index, {
        type: "heading",
        headingLevel,
        fontSize: headingFontSize(headingLevel),
      });
    } else if (event.altKey && key === "0") {
      event.preventDefault();
      updateBlock(index, {
        type: "paragraph",
        headingLevel: undefined,
        fontSize: "14",
      });
    } else if (event.shiftKey && key === "n") {
      event.preventDefault();
      updateBlock(index, {
        type: "paragraph",
        headingLevel: undefined,
        fontSize: model.blocks[index]?.fontSize ?? "14",
        listKind: undefined,
      });
    } else if (event.shiftKey && key === "c") {
      event.preventDefault();
      const block = model.blocks[index];
      if (isDocxTextBlock(block)) setFormatClipboard(pickDocxFormatting(block));
    } else if (event.shiftKey && key === "v") {
      event.preventDefault();
      if (formatClipboard && isDocxTextBlock(model.blocks[index])) {
        updateBlock(index, formatClipboard);
      }
    } else if (event.altKey && key === "f") {
      event.preventDefault();
      insertNoteReference("footnote", index);
    } else if (event.altKey && key === "e") {
      event.preventDefault();
      insertNoteReference("endnote", index);
    } else if (key === "l") {
      event.preventDefault();
      updateBlock(index, { align: "left" });
    } else if (key === "e") {
      event.preventDefault();
      updateBlock(index, { align: "center" });
    } else if (key === "r") {
      event.preventDefault();
      updateBlock(index, { align: "right" });
    } else if (key === "j") {
      event.preventDefault();
      updateBlock(index, { align: "justify" });
    } else if (event.shiftKey && (key === "*" || event.code === "Digit8")) {
      event.preventDefault();
      toggleBlockList(index, "bullet");
    } else if (event.shiftKey && (key === "&" || event.code === "Digit7")) {
      event.preventDefault();
      toggleBlockList(index, "number");
    }
  }

  function toggleBlockList(index: number, listKind: "bullet" | "number") {
    const current = model.blocks[index];
    if (!isDocxTextBlock(current)) return;
    updateBlock(index, {
      type: "paragraph",
      headingLevel: undefined,
      fontSize: current.type === "heading" ? "14" : current.fontSize,
      listKind: current.listKind === listKind ? undefined : listKind,
    });
  }

  function toggleActiveList(listKind: "bullet" | "number") {
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    if (index >= 0) toggleBlockList(index, listKind);
  }

  function adjustActiveIndent(delta: number) {
    const current = activeBlock?.indentLeft ?? 0;
    updateActive({ indentLeft: Math.max(0, current + delta) });
  }

  function toggleActiveVerticalAlign(verticalAlign: NonNullable<DocxBlock["verticalAlign"]>) {
    updateActive({
      verticalAlign:
        activeBlock?.verticalAlign === verticalAlign ? undefined : verticalAlign,
    });
  }

  function splitTextBlockAtCaret(index: number, element: HTMLElement) {
    const block = model.blocks[index];
    if (!isDocxTextBlock(block)) return;
    const text = element.textContent ?? block.text;
    const offset = textOffsetWithin(element);
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    const next: DocxBlock = {
      ...block,
      id: nextDocxBlockId(model.blocks, "p"),
      type: block.type === "heading" ? "paragraph" : block.type,
      text: after,
      headingLevel: undefined,
      fontSize: block.type === "heading" ? "14" : block.fontSize,
    };
    replaceBlocks(
      model.blocks.flatMap((item, blockIndex) =>
        blockIndex === index ? [{ ...item, text: before }, next] : [item],
      ),
      next.id,
    );
  }

  function mergeWithPreviousBlock(index: number, element: HTMLElement) {
    if (index <= 0 || textOffsetWithin(element) !== 0) return false;
    const current = model.blocks[index];
    const previous = model.blocks[index - 1];
    if (!isDocxTextBlock(current) || !isDocxTextBlock(previous)) {
      return false;
    }
    const mergedText = `${previous.text}${current.text}`;
    replaceBlocks(
      model.blocks
        .map((block, blockIndex) =>
          blockIndex === index - 1 ? { ...block, text: mergedText } : block,
        )
        .filter((_, blockIndex) => blockIndex !== index),
      previous.id,
    );
    return true;
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (!activeBlock) return false;
    if (commandId === "bold") {
      updateActive({ bold: !activeBlock.bold });
    } else if (commandId === "italic") {
      updateActive({ italic: !activeBlock.italic });
    } else if (commandId === "underline") {
      updateActive({ underline: !activeBlock.underline });
    } else if (commandId === "link") {
      openLinkEditor();
    } else if (commandId === "normalStyle") {
      applyNormalStyle();
    } else if (commandId === "strikethrough") {
      updateActive({ strikethrough: !activeBlock.strikethrough });
    } else if (commandId === "heading1") {
      updateActive({
        type: "heading",
        headingLevel: 1,
        fontSize: headingFontSize(1),
      });
    } else if (commandId === "heading2") {
      updateActive({
        type: "heading",
        headingLevel: 2,
        fontSize: headingFontSize(2),
      });
    } else if (commandId === "heading3") {
      updateActive({
        type: "heading",
        headingLevel: 3,
        fontSize: headingFontSize(3),
      });
    } else if (commandId === "heading4") {
      updateActive({
        type: "heading",
        headingLevel: 4,
        fontSize: headingFontSize(4),
      });
    } else if (commandId === "heading5") {
      updateActive({
        type: "heading",
        headingLevel: 5,
        fontSize: headingFontSize(5),
      });
    } else if (commandId === "heading6") {
      updateActive({
        type: "heading",
        headingLevel: 6,
        fontSize: headingFontSize(6),
      });
    } else if (commandId === "alignLeft") {
      updateActive({ align: "left" });
    } else if (commandId === "alignCenter") {
      updateActive({ align: "center" });
    } else if (commandId === "alignRight") {
      updateActive({ align: "right" });
    } else if (commandId === "alignJustify") {
      updateActive({ align: "justify" });
    } else if (commandId === "bulletList") {
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleBlockList(index, "bullet");
    } else if (commandId === "numberedList") {
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleBlockList(index, "number");
    } else if (commandId === "pageBreak") {
      insertPageBreak();
    } else if (commandId === "indent") {
      adjustActiveIndent(360);
    } else if (commandId === "outdent") {
      adjustActiveIndent(-360);
    } else if (commandId === "copyFormatting") {
      copyActiveFormatting();
    } else if (commandId === "pasteFormatting") {
      pasteActiveFormatting();
    } else if (commandId === "footnote") {
      insertNoteReference("footnote");
    } else if (commandId === "endnote") {
      insertNoteReference("endnote");
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

  function pasteTextIntoBlock(
    index: number,
    element: HTMLElement,
    pastedText: string,
  ) {
    const block = model.blocks[index];
    if (!isDocxTextBlock(block)) return;
    const normalized = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.includes("\n")) return;
    const currentText = element.textContent ?? block.text;
    const offset = textOffsetWithin(element);
    const before = currentText.slice(0, offset);
    const after = currentText.slice(offset);
    const parts = normalized.split("\n");
    const usedIds = new Set(model.blocks.map((item) => item.id));
    const inserted = parts.map((part, partIndex): DocxBlock => ({
      ...block,
      id: partIndex === 0 ? block.id : allocateDocxBlockId(usedIds, "p"),
      type: partIndex === 0 && block.type === "heading" ? "heading" : "paragraph",
      headingLevel:
        partIndex === 0 && block.type === "heading"
          ? block.headingLevel ?? 1
          : undefined,
      fontSize:
        partIndex === 0 && block.type === "heading"
          ? block.fontSize
          : block.type === "heading"
            ? "14"
            : block.fontSize,
      text:
        partIndex === 0
          ? `${before}${part}`
          : partIndex === parts.length - 1
            ? `${part}${after}`
            : part,
    }));
    replaceBlocks(
      model.blocks.flatMap((item, blockIndex) =>
        blockIndex === index ? inserted : [item],
      ),
      inserted.at(-1)?.id,
    );
  }

  function updateTableCell(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, updateDocxTableCell(block, rowIndex, columnIndex, value));
  }

  function addTableRow(blockIndex: number) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, addDocxTableRow(block));
  }

  function insertTableRow(
    blockIndex: number,
    rowIndex: number,
    position: "above" | "below",
  ) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, insertDocxTableRow(block, rowIndex, position));
  }

  function addTableColumn(blockIndex: number) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, addDocxTableColumn(block));
  }

  function insertTableColumn(
    blockIndex: number,
    columnIndex: number,
    position: "left" | "right",
  ) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, insertDocxTableColumn(block, columnIndex, position));
  }

  function duplicateTableRow(blockIndex: number, rowIndex: number) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, duplicateDocxTableRow(block, rowIndex));
  }

  function duplicateTableColumn(blockIndex: number, columnIndex: number) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, duplicateDocxTableColumn(block, columnIndex));
  }

  function moveTableRow(blockIndex: number, rowIndex: number, direction: -1 | 1) {
    const block = model.blocks[blockIndex];
    const patch = moveDocxTableRow(block, rowIndex, direction);
    if (patch) updateBlock(blockIndex, patch);
  }

  function moveTableColumn(
    blockIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ) {
    const block = model.blocks[blockIndex];
    const patch = moveDocxTableColumn(block, columnIndex, direction);
    if (patch) updateBlock(blockIndex, patch);
  }

  function deleteTableRow(blockIndex: number, rowIndex: number) {
    const block = model.blocks[blockIndex];
    const patch = deleteDocxTableRow(block, rowIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function deleteTableColumn(blockIndex: number, columnIndex: number) {
    const block = model.blocks[blockIndex];
    const patch = deleteDocxTableColumn(block, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function clearTableCell(blockIndex: number, rowIndex: number, columnIndex: number) {
    updateTableCell(blockIndex, rowIndex, columnIndex, "");
  }

  function pasteTableCells(
    blockIndex: number,
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    const block = model.blocks[blockIndex];
    const patch = pasteDocxTableCells(block, startRow, startColumn, matrix);
    if (patch) updateBlock(blockIndex, patch);
  }

  function updateTableColumnWidth(
    blockIndex: number,
    columnIndex: number,
    width: number,
  ) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, resizeDocxTableColumn(block, columnIndex, width));
  }

  function updateTableRowHeight(
    blockIndex: number,
    rowIndex: number,
    height: number,
  ) {
    const block = model.blocks[blockIndex];
    updateBlock(blockIndex, resizeDocxTableRow(block, rowIndex, height));
  }

  function updateImageBlock(index: number, patch: Partial<DocxBlock>) {
    const block = model.blocks[index];
    if (!block || block.type !== "image") return;
    updateBlock(index, patch);
  }

  function updateTextPart(
    kind: "headers" | "footers",
    index: number,
    text: string,
  ) {
    const parts = model[kind] ?? [];
    onChange({
      ...model,
      [kind]: parts.map((part, partIndex) =>
        partIndex === index ? { ...part, text } : part,
      ),
    });
  }

  function updateComment(index: number, patch: Partial<DocxComment>) {
    const comments = model.comments ?? [];
    onChange({
      ...model,
      comments: comments.map((comment, commentIndex) =>
        commentIndex === index ? { ...comment, ...patch } : comment,
      ),
    });
  }

  function deleteComment(index: number) {
    const comments = model.comments ?? [];
    onChange({
      ...model,
      comments: comments.filter((_, commentIndex) => commentIndex !== index),
    });
  }

  function updateNote(
    kind: "footnotes" | "endnotes",
    index: number,
    text: string,
  ) {
    const notes = model[kind] ?? [];
    onChange({
      ...model,
      [kind]: notes.map((note, noteIndex) =>
        noteIndex === index ? { ...note, text } : note,
      ),
    });
  }

  function deleteNote(kind: "footnotes" | "endnotes", index: number) {
    const notes = model[kind] ?? [];
    const note = notes[index];
    if (!note) return;
    const blockKey = kind === "footnotes" ? "footnoteId" : "endnoteId";
    onChange({
      ...model,
      blocks: model.blocks.map((block) =>
        block[blockKey] === note.id ? { ...block, [blockKey]: undefined } : block,
      ),
      [kind]: notes.filter((_, noteIndex) => noteIndex !== index),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
        <select
          value={
            activeBlock?.type === "heading"
              ? `heading:${activeBlock.headingLevel ?? 1}`
              : activeBlock?.type ?? "paragraph"
          }
          onChange={(event) => {
            const value = event.target.value;
            if (value === "image") return;
            if (value === "pageBreak") {
              updateActive({
                type: "pageBreak",
                text: "",
                headingLevel: undefined,
                rows: undefined,
                tableColumnWidths: undefined,
                tableRowHeights: undefined,
                listKind: undefined,
                target: undefined,
                relationshipId: undefined,
              });
              return;
            }
            if (value === "sectionBreak") {
              updateActive({
                type: "sectionBreak",
                text: "",
                headingLevel: undefined,
                rows: undefined,
                tableColumnWidths: undefined,
                tableRowHeights: undefined,
                listKind: undefined,
                target: undefined,
                relationshipId: undefined,
                breakKind: activeBlock?.breakKind ?? "nextPage",
              });
              return;
            }
            const headingMatch = /^heading:(\d)$/.exec(value);
            const type = headingMatch ? "heading" : (value as DocxBlock["type"]);
            const headingLevel = headingMatch ? Number(headingMatch[1]) : undefined;
            const tableRows = activeBlock?.rows ?? [["", ""], ["", ""]];
            updateActive({
              type,
              headingLevel,
              text: type === "table" ? "" : activeBlock?.text ?? "",
              rows: type === "table" ? tableRows : undefined,
              tableColumnWidths:
                type === "table"
                  ? normalizeDocxTableColumnWidths(
                      activeBlock?.tableColumnWidths,
                      tableColumnCount(tableRows),
                    )
                  : undefined,
              tableRowHeights:
                type === "table"
                  ? normalizeDocxTableRowHeights(
                      activeBlock?.tableRowHeights,
                      tableRows.length,
                    )
                  : undefined,
              fontSize:
                type === "heading"
                  ? headingFontSize(headingLevel ?? 1)
                  : activeBlock?.fontSize ?? "14",
            });
          }}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title={t("documentEditor.style", { defaultValue: "Style" })}
        >
          <option value="paragraph">Normal text</option>
          {Array.from({ length: 6 }, (_, index) => index + 1).map((level) => (
            <option key={level} value={`heading:${level}`}>
              Heading {level}
            </option>
          ))}
          <option value="table">Table</option>
          <option value="pageBreak">Page break</option>
          <option value="sectionBreak">Section break</option>
          {activeBlock?.type === "image" && <option value="image">Image</option>}
        </select>
        {activeBlock?.type === "sectionBreak" && (
          <select
            value={activeBlock.breakKind ?? "nextPage"}
            onChange={(event) =>
              updateActive({
                breakKind: event.target.value as NonNullable<DocxBlock["breakKind"]>,
              })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Section break kind"
          >
            <option value="nextPage">Next page</option>
            <option value="continuous">Continuous</option>
            <option value="evenPage">Even page</option>
            <option value="oddPage">Odd page</option>
          </select>
        )}
        <FontFamilySelect
          value={activeBlock?.fontFamily}
          onChange={(fontFamily) => updateActive({ fontFamily })}
          compact
        />
        <select
          value={
            activeBlock?.fontSize ??
            (activeBlock?.type === "heading"
              ? headingFontSize(activeBlock.headingLevel ?? 1)
              : "14")
          }
          onChange={(event) => updateActive({ fontSize: event.target.value })}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title={t("documentEditor.fontSize", { defaultValue: "Font size" })}
        >
          {["10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        <ToolbarButton
          icon={Bold}
          label={t("documentEditor.bold")}
          onClick={() => updateActive({ bold: !activeBlock?.bold })}
          active={activeBlock?.bold}
        />
        <ToolbarButton
          icon={Italic}
          label={t("documentEditor.italic")}
          onClick={() => updateActive({ italic: !activeBlock?.italic })}
          active={activeBlock?.italic}
        />
        <ToolbarButton
          icon={Underline}
          label={t("documentEditor.underline", { defaultValue: "Underline" })}
          onClick={() => updateActive({ underline: !activeBlock?.underline })}
          active={activeBlock?.underline}
        />
        <ToolbarButton
          icon={Link}
          label={t("documentEditor.link")}
          onClick={openLinkEditor}
          active={Boolean(activeBlock?.target)}
          disabled={!activeBlock || activeBlock.type === "table" || activeBlock.type === "image"}
        />
        <ToolbarButton
          icon={FileText}
          label="Normal style"
          onClick={applyNormalStyle}
          active={activeBlock?.type === "paragraph" && !activeBlock.listKind}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={Copy}
          label="Copy formatting"
          onClick={copyActiveFormatting}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={Eraser}
          label="Paste formatting"
          onClick={pasteActiveFormatting}
          disabled={!formatClipboard || !isDocxTextBlock(activeBlock)}
        />
        {linkInputOpen && (
          <form
            className="flex min-w-56 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              applyLinkDraft();
            }}
          >
            <input
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder={t("documentEditor.linkUrl")}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="inline-flex h-8 items-center rounded-md bg-[var(--accent)] px-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              {t("documentEditor.applyLink")}
            </button>
          </form>
        )}
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          onClick={() =>
            updateActive({ strikethrough: !activeBlock?.strikethrough })
          }
          active={activeBlock?.strikethrough}
        />
        <ToolbarButton
          icon={Superscript}
          label="Superscript"
          onClick={() => toggleActiveVerticalAlign("superscript")}
          active={activeBlock?.verticalAlign === "superscript"}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={Subscript}
          label="Subscript"
          onClick={() => toggleActiveVerticalAlign("subscript")}
          active={activeBlock?.verticalAlign === "subscript"}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={Highlighter}
          label={t("documentEditor.highlight", { defaultValue: "Highlight" })}
          onClick={() =>
            updateActive({ highlight: activeBlock?.highlight ? undefined : "#fef08a" })
          }
          active={Boolean(activeBlock?.highlight)}
        />
        <label
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("documentEditor.textColor", { defaultValue: "Text color" })}
        >
          <Palette className="h-4 w-4" strokeWidth={1.75} />
          <input
            type="color"
            value={activeBlock?.color ?? "#111827"}
            onChange={(event) => updateActive({ color: event.target.value })}
            className="sr-only"
          />
        </label>
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        <ToolbarButton
          icon={AlignLeft}
          label="Left"
          onClick={() => updateActive({ align: "left" })}
          active={!activeBlock?.align || activeBlock.align === "left"}
        />
        <ToolbarButton
          icon={AlignCenter}
          label="Center"
          onClick={() => updateActive({ align: "center" })}
          active={activeBlock?.align === "center"}
        />
        <ToolbarButton
          icon={AlignRight}
          label="Right"
          onClick={() => updateActive({ align: "right" })}
          active={activeBlock?.align === "right"}
        />
        <ToolbarButton
          icon={AlignJustify}
          label="Justify"
          onClick={() => updateActive({ align: "justify" })}
          active={activeBlock?.align === "justify"}
        />
        <ToolbarButton
          icon={IndentDecrease}
          label={t("documentEditor.outdent", { defaultValue: "Outdent" })}
          onClick={() => adjustActiveIndent(-360)}
          disabled={!activeBlock?.indentLeft}
        />
        <ToolbarButton
          icon={IndentIncrease}
          label={t("documentEditor.indent", { defaultValue: "Indent" })}
          onClick={() => adjustActiveIndent(360)}
        />
        <ToolbarButton
          icon={List}
          label={t("documentEditor.bullets")}
          onClick={() => toggleActiveList("bullet")}
          active={activeBlock?.listKind === "bullet"}
          disabled={!activeBlock || activeBlock.type === "table"}
        />
        <ToolbarButton
          icon={ListOrdered}
          label={t("documentEditor.numbered")}
          onClick={() => toggleActiveList("number")}
          active={activeBlock?.listKind === "number"}
          disabled={!activeBlock || activeBlock.type === "table"}
        />
        <select
          value={activeBlock?.lineSpacing ?? 276}
          onChange={(event) => updateActive({ lineSpacing: Number(event.target.value) })}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title={t("documentEditor.lineSpacing", { defaultValue: "Line spacing" })}
        >
          <option value={240}>1.0</option>
          <option value={276}>1.15</option>
          <option value={360}>1.5</option>
          <option value={480}>2.0</option>
        </select>
        <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
          Before
          <input
            type="number"
            min={0}
            max={72}
            value={twipsToPoints(activeBlock?.spacingBefore ?? 0)}
            onChange={(event) =>
              updateActive({ spacingBefore: pointsToTwips(Number(event.target.value)) })
            }
            className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
          />
        </label>
        <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
          After
          <input
            type="number"
            min={0}
            max={72}
            value={twipsToPoints(activeBlock?.spacingAfter ?? 0)}
            onChange={(event) =>
              updateActive({ spacingAfter: pointsToTwips(Number(event.target.value)) })
            }
            className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
          />
        </label>
        <ToolbarButton
          icon={FileText}
          label="Page break before"
          onClick={() =>
            updateActive({ pageBreakBefore: !activeBlock?.pageBreakBefore })
          }
          active={activeBlock?.pageBreakBefore}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={FileText}
          label="Footnote"
          onClick={() => insertNoteReference("footnote")}
          active={Boolean(activeBlock?.footnoteId)}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <ToolbarButton
          icon={FileText}
          label="Endnote"
          onClick={() => insertNoteReference("endnote")}
          active={Boolean(activeBlock?.endnoteId)}
          disabled={!isDocxTextBlock(activeBlock)}
        />
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        <select
          value={docxPagePresetValue(page)}
          onChange={(event) => updatePagePreset(event.target.value)}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title={t("documentEditor.pageSize", {
            defaultValue: "Page size",
          })}
        >
          <option value="custom">Custom</option>
          {DOCX_PAGE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
        <select
          value={page?.orientation ?? "portrait"}
          onChange={(event) =>
            updatePageOrientation(
              event.target.value === "landscape" ? "landscape" : "portrait",
            )
          }
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title={t("documentEditor.pageOrientation", {
            defaultValue: "Page orientation",
          })}
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
        <DocxMarginInput
          label="Top"
          value={page?.marginTop}
          onChange={(marginTop) => updatePage({ marginTop })}
        />
        <DocxMarginInput
          label="Right"
          value={page?.marginRight}
          onChange={(marginRight) => updatePage({ marginRight })}
        />
        <DocxMarginInput
          label="Bottom"
          value={page?.marginBottom}
          onChange={(marginBottom) => updatePage({ marginBottom })}
        />
        <DocxMarginInput
          label="Left"
          value={page?.marginLeft}
          onChange={(marginLeft) => updatePage({ marginLeft })}
        />
        <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        {hasDocumentParts && (
          <>
            <button
              type="button"
              onClick={() => setTextPartsOpen((current) => !current)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                textPartsOpen && "border-[var(--accent)] text-[var(--accent)]",
              )}
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
              Parts
            </button>
            <div className="mx-1 h-5 w-px bg-[var(--border)]" />
          </>
        )}
        <ToolbarButton
          icon={ChevronUp}
          label="Move up"
          onClick={() => moveActiveBlock(-1)}
        />
        <ToolbarButton
          icon={ChevronDown}
          label="Move down"
          onClick={() => moveActiveBlock(1)}
        />
        <ToolbarButton
          icon={Trash2}
          label={t("common.delete")}
          onClick={deleteActiveBlock}
        />
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) insertImageFile(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
            Image
          </button>
          <button
            type="button"
            onClick={() => addBlock("heading")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <Heading1 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Heading
          </button>
          <button
            type="button"
            onClick={() => addBlock("table")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
            Table
          </button>
          <button
            type="button"
            onClick={insertPageBreak}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            Page break
          </button>
          <button
            type="button"
            onClick={insertSectionBreak}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            Section break
          </button>
          <button
            type="button"
            onClick={() => addBlock("paragraph")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("documentEditor.addParagraph")}
          </button>
        </div>
      </div>
      {hasDocumentParts && textPartsOpen && (
        <DocxTextPartsPanel
          headers={model.headers ?? []}
          footers={model.footers ?? []}
          comments={model.comments ?? []}
          footnotes={model.footnotes ?? []}
          endnotes={model.endnotes ?? []}
          onHeaderChange={(index, text) => updateTextPart("headers", index, text)}
          onFooterChange={(index, text) => updateTextPart("footers", index, text)}
          onCommentChange={updateComment}
          onCommentDelete={deleteComment}
          onFootnoteChange={(index, text) => updateNote("footnotes", index, text)}
          onFootnoteDelete={(index) => deleteNote("footnotes", index)}
          onEndnoteChange={(index, text) => updateNote("endnotes", index, text)}
          onEndnoteDelete={(index) => deleteNote("endnotes", index)}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-6">
        <DocxRuler page={model.page} onChange={updatePage} />
        <div
          className="mx-auto min-h-[980px] max-w-full border border-[var(--border)] bg-white text-neutral-950 shadow-sm"
          style={docxPageStyle(model.page)}
        >
          {model.blocks.length === 0 && (
            <button
              type="button"
              onClick={() => addBlock("paragraph")}
              className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500"
            >
              {t("documentEditor.addParagraph")}
            </button>
          )}
          {model.blocks.map((block, index) => {
            const isActive = block.id === activeBlock?.id;
            if (block.type === "image") {
              return (
                <DocxImageBlock
                  key={block.id}
                  block={block}
                  active={isActive}
                  onFocus={() => setActiveBlockId(block.id)}
                  onChange={(patch) => updateImageBlock(index, patch)}
                />
              );
            }
            if (block.type === "pageBreak") {
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setActiveBlockId(block.id)}
                  data-docx-block={block.id}
                  className={cn(
                    "my-6 flex w-full items-center gap-3 rounded-sm px-1 py-3 text-left text-[11px] uppercase tracking-[0.08em] text-neutral-400 outline-none",
                    isActive && "ring-1 ring-[var(--accent)]/30",
                  )}
                >
                  <span className="h-px flex-1 bg-neutral-300" />
                  <span>Page break</span>
                  <span className="h-px flex-1 bg-neutral-300" />
                </button>
              );
            }
            if (block.type === "sectionBreak") {
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setActiveBlockId(block.id)}
                  data-docx-block={block.id}
                  className={cn(
                    "my-6 flex w-full items-center gap-3 rounded-sm px-1 py-3 text-left text-[11px] uppercase tracking-[0.08em] text-neutral-400 outline-none",
                    isActive && "ring-1 ring-[var(--accent)]/30",
                  )}
                >
                  <span className="h-px flex-1 bg-neutral-300" />
                  <span>Section break · {sectionBreakLabel(block.breakKind)}</span>
                  <span className="h-px flex-1 bg-neutral-300" />
                </button>
              );
            }
            if (block.type === "table") {
              return (
                <DocxTableBlock
                  key={block.id}
                  block={block}
                  active={isActive}
                  onFocus={() => setActiveBlockId(block.id)}
                  onCellChange={(rowIndex, columnIndex, value) =>
                    updateTableCell(index, rowIndex, columnIndex, value)
                  }
                  onAddRow={() => addTableRow(index)}
                  onAddColumn={() => addTableColumn(index)}
                  onInsertRow={(rowIndex, position) =>
                    insertTableRow(index, rowIndex, position)
                  }
                  onInsertColumn={(columnIndex, position) =>
                    insertTableColumn(index, columnIndex, position)
                  }
                  onDuplicateRow={(rowIndex) => duplicateTableRow(index, rowIndex)}
                  onDuplicateColumn={(columnIndex) =>
                    duplicateTableColumn(index, columnIndex)
                  }
                  onMoveRow={(rowIndex, direction) =>
                    moveTableRow(index, rowIndex, direction)
                  }
                  onMoveColumn={(columnIndex, direction) =>
                    moveTableColumn(index, columnIndex, direction)
                  }
                  onColumnWidthChange={(columnIndex, width) =>
                    updateTableColumnWidth(index, columnIndex, width)
                  }
                  onRowHeightChange={(rowIndex, height) =>
                    updateTableRowHeight(index, rowIndex, height)
                  }
                  onDeleteRow={(rowIndex) => deleteTableRow(index, rowIndex)}
                  onDeleteColumn={(columnIndex) =>
                    deleteTableColumn(index, columnIndex)
                  }
                  onClearCell={(rowIndex, columnIndex) =>
                    clearTableCell(index, rowIndex, columnIndex)
                  }
                  onPasteCells={(rowIndex, columnIndex, matrix) =>
                    pasteTableCells(index, rowIndex, columnIndex, matrix)
                  }
                />
              );
            }
            return (
              <div key={block.id} className="relative">
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onFocus={() => setActiveBlockId(block.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      insertPageBreak();
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      splitTextBlockAtCaret(index, event.currentTarget);
                      return;
                    }
                    if (event.key === "Backspace" && mergeWithPreviousBlock(index, event.currentTarget)) {
                      event.preventDefault();
                      return;
                    }
                    handleBlockShortcut(event, index);
                  }}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData("text/plain");
                    if (text.includes("\n") || text.includes("\r")) {
                      event.preventDefault();
                      pasteTextIntoBlock(index, event.currentTarget, text);
                    }
                  }}
                  onInput={(event) =>
                    updateBlock(index, { text: event.currentTarget.textContent ?? "" })
                  }
                  data-docx-block={block.id}
                  className={cn(
                    "min-h-7 rounded-sm px-1 py-1 outline-none",
                    isActive && "ring-1 ring-[var(--accent)]/30",
                    block.type === "heading" ? "mb-3 mt-4 font-semibold" : "mb-2 leading-7",
                    block.pageBreakBefore &&
                      "mt-8 border-t border-dashed border-neutral-300 pt-4",
                  )}
                  style={{
                    fontFamily: block.fontFamily || builtInFontFamilies[0],
                    fontSize: `${block.fontSize ?? (block.type === "heading" ? headingFontSize(block.headingLevel ?? 1) : "14")}px`,
                    fontWeight: block.bold || block.type === "heading" ? 700 : 400,
                    fontStyle: block.italic ? "italic" : undefined,
                    verticalAlign:
                      block.verticalAlign === "superscript"
                        ? "super"
                        : block.verticalAlign === "subscript"
                          ? "sub"
                          : undefined,
                    textDecorationLine: [
                      block.underline || block.target ? "underline" : "",
                      block.strikethrough ? "line-through" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                    color: block.target ? (block.color ?? "#2563eb") : block.color,
                    textAlign: block.align ?? "left",
                    display: block.listKind ? "list-item" : undefined,
                    listStyleType:
                      block.listKind === "bullet"
                        ? "disc"
                        : block.listKind === "number"
                          ? "decimal"
                          : undefined,
                    listStylePosition: block.listKind ? "outside" : undefined,
                    marginLeft: block.listKind ? "1.5rem" : undefined,
                    paddingLeft: block.indentLeft
                      ? `${twipsToCssPixels(block.indentLeft)}px`
                      : undefined,
                    lineHeight: block.lineSpacing
                      ? String(block.lineSpacing / 240)
                      : undefined,
                    marginTop: block.spacingBefore
                      ? `${twipsToCssPixels(block.spacingBefore)}px`
                      : undefined,
                    marginBottom: block.spacingAfter
                      ? `${twipsToCssPixels(block.spacingAfter)}px`
                      : undefined,
                    backgroundColor: block.highlight,
                  }}
                >
                  {block.text}
                </div>
                {block.footnoteId && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBlockId(block.id);
                      setTextPartsOpen(true);
                    }}
                    className="absolute right-0 top-0 -translate-y-1/3 rounded-sm px-1 align-super text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
                    title="Footnote"
                  >
                    {block.footnoteId}
                  </button>
                )}
                {block.endnoteId && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBlockId(block.id);
                      setTextPartsOpen(true);
                    }}
                    className="absolute right-6 top-0 -translate-y-1/3 rounded-sm px-1 align-super text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"
                    title="Endnote"
                  >
                    {block.endnoteId}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
