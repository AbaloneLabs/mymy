import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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
import { builtInFontFamilies } from "../fonts";
import { columnName } from "../models";
import type {
  DocxBlock,
  DocxComment,
  DocxModel,
  DocxNote,
  DocxPageSettings,
  DocxTextPart,
} from "../models";
import { FontFamilySelect, ToolbarButton } from "../shared";

const TWIPS_PER_INCH = 1440;
const DOCX_HEADING_FONT_SIZES: Record<number, string> = {
  1: "32",
  2: "28",
  3: "24",
  4: "20",
  5: "18",
  6: "16",
};
const DOCX_PAGE_PRESETS = [
  { label: "Letter", value: "letter", width: 12_240, height: 15_840 },
  { label: "A4", value: "a4", width: 11_906, height: 16_838 },
  { label: "Legal", value: "legal", width: 12_240, height: 20_160 },
] as const;

const DOCX_FORMAT_KEYS = [
  "type",
  "headingLevel",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "verticalAlign",
  "fontFamily",
  "fontSize",
  "color",
  "highlight",
  "align",
  "listKind",
  "indentLeft",
  "spacingBefore",
  "spacingAfter",
  "lineSpacing",
  "pageBreakBefore",
] as const;

type DocxFormatClipboard = Partial<
  Pick<DocxBlock, (typeof DOCX_FORMAT_KEYS)[number]>
>;

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
    const rows = block.rows ?? [[""]];
    updateBlock(blockIndex, {
      rows: rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? normalizeDocxTableRow(row, tableColumnCount(rows)).map((cell, currentColumnIndex) =>
              currentColumnIndex === columnIndex ? value : cell,
            )
          : normalizeDocxTableRow(row, tableColumnCount(rows)),
      ),
    });
  }

  function addTableRow(blockIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    updateBlock(blockIndex, {
      rows: [...rows.map((row) => normalizeDocxTableRow(row, columns)), Array(columns).fill("")],
    });
  }

  function insertTableRow(
    blockIndex: number,
    rowIndex: number,
    position: "above" | "below",
  ) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
    const insertAt = position === "above" ? rowIndex : rowIndex + 1;
    normalizedRows.splice(insertAt, 0, Array(columns).fill(""));
    updateBlock(blockIndex, { rows: normalizedRows });
  }

  function addTableColumn(blockIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    updateBlock(blockIndex, {
      rows: rows.map((row) => [...normalizeDocxTableRow(row, columns), ""]),
    });
  }

  function insertTableColumn(
    blockIndex: number,
    columnIndex: number,
    position: "left" | "right",
  ) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    const insertAt = position === "left" ? columnIndex : columnIndex + 1;
    updateBlock(blockIndex, {
      rows: rows.map((row) => {
        const cells = normalizeDocxTableRow(row, columns);
        cells.splice(insertAt, 0, "");
        return cells;
      }),
    });
  }

  function duplicateTableRow(blockIndex: number, rowIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
    normalizedRows.splice(rowIndex + 1, 0, [...normalizedRows[rowIndex]]);
    updateBlock(blockIndex, { rows: normalizedRows });
  }

  function duplicateTableColumn(blockIndex: number, columnIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    updateBlock(blockIndex, {
      rows: rows.map((row) => {
        const cells = normalizeDocxTableRow(row, columns);
        cells.splice(columnIndex + 1, 0, cells[columnIndex] ?? "");
        return cells;
      }),
    });
  }

  function moveTableRow(blockIndex: number, rowIndex: number, direction: -1 | 1) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    const nextIndex = rowIndex + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
    const [moved] = normalizedRows.splice(rowIndex, 1);
    normalizedRows.splice(nextIndex, 0, moved);
    updateBlock(blockIndex, { rows: normalizedRows });
  }

  function moveTableColumn(
    blockIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    const nextIndex = columnIndex + direction;
    if (nextIndex < 0 || nextIndex >= columns) return;
    updateBlock(blockIndex, {
      rows: rows.map((row) => {
        const cells = normalizeDocxTableRow(row, columns);
        const [moved] = cells.splice(columnIndex, 1);
        cells.splice(nextIndex, 0, moved);
        return cells;
      }),
    });
  }

  function deleteTableRow(blockIndex: number, rowIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    if (rows.length <= 1) return;
    updateBlock(blockIndex, {
      rows: rows.filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
    });
  }

  function deleteTableColumn(blockIndex: number, columnIndex: number) {
    const block = model.blocks[blockIndex];
    const rows = block.rows ?? [[""]];
    const columns = tableColumnCount(rows);
    if (columns <= 1) return;
    updateBlock(blockIndex, {
      rows: rows.map((row) =>
        normalizeDocxTableRow(row, columns).filter(
          (_, currentColumnIndex) => currentColumnIndex !== columnIndex,
        ),
      ),
    });
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
    const rows = block.rows ?? [[""]];
    if (matrix.length === 0) return;
    const currentColumns = tableColumnCount(rows);
    const requiredRows = Math.max(rows.length, startRow + matrix.length);
    const requiredColumns = Math.max(
      currentColumns,
      startColumn + Math.max(...matrix.map((row) => row.length)),
    );
    const nextRows = Array.from({ length: requiredRows }, (_, rowIndex) =>
      normalizeDocxTableRow(rows[rowIndex] ?? [], requiredColumns),
    );
    matrix.forEach((matrixRow, rowOffset) => {
      matrixRow.forEach((value, columnOffset) => {
        nextRows[startRow + rowOffset][startColumn + columnOffset] = value;
      });
    });
    updateBlock(blockIndex, { rows: nextRows });
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
            updateActive({
              type,
              headingLevel,
              text: type === "table" ? "" : activeBlock?.text ?? "",
              rows:
                type === "table"
                  ? (activeBlock?.rows ?? [["", ""], ["", ""]])
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
          onFootnoteChange={(index, text) => updateNote("footnotes", index, text)}
          onEndnoteChange={(index, text) => updateNote("endnotes", index, text)}
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
              <div
                key={block.id}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocxRuler({
  page,
  onChange,
}: {
  page: DocxPageSettings | undefined;
  onChange: (patch: Partial<DocxPageSettings>) => void;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const pageWidth = twipsToCssPixels(page?.width ?? DOCX_PAGE_PRESETS[0].width);
  const marginLeft = page?.marginLeft ?? TWIPS_PER_INCH;
  const marginRight = page?.marginRight ?? TWIPS_PER_INCH;
  const leftPercent = Math.min(100, Math.max(0, (marginLeft / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const rightPercent = Math.min(100, Math.max(0, 100 - (marginRight / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const ticks = Array.from({ length: Math.ceil(twipsToInches(page?.width ?? DOCX_PAGE_PRESETS[0].width)) + 1 }, (_, index) => index);

  function updateMarginFromPointer(
    event: ReactPointerEvent<HTMLButtonElement>,
    side: "left" | "right",
  ) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const pageWidthTwips = page?.width ?? DOCX_PAGE_PRESETS[0].width;
    const next = Math.round((x / rect.width) * pageWidthTwips);
    if (side === "left") {
      onChange({ marginLeft: Math.min(next, pageWidthTwips - marginRight - 720) });
    } else {
      onChange({ marginRight: Math.min(pageWidthTwips - next, pageWidthTwips - marginLeft - 720) });
    }
  }

  function startDrag(side: "left" | "right", event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMarginFromPointer(event, side);
  }

  return (
    <div
      ref={rulerRef}
      className="relative mx-auto mb-3 h-8 max-w-full border border-[var(--border)] bg-[var(--bg)] text-[10px] text-[var(--text-faint)]"
      style={{ width: pageWidth }}
    >
      <div
        className="absolute inset-y-0 bg-[var(--surface-muted)]"
        style={{ left: `${leftPercent}%`, right: `${100 - rightPercent}%` }}
      />
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute bottom-0 top-0 border-l border-[var(--border)]"
          style={{ left: `${(tick / Math.max(1, ticks.length - 1)) * 100}%` }}
        >
          <span className="absolute left-1 top-0.5">{tick}</span>
        </div>
      ))}
      <button
        type="button"
        onPointerDown={(event) => startDrag("left", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "left");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${leftPercent}%` }}
        title="Left margin"
      />
      <button
        type="button"
        onPointerDown={(event) => startDrag("right", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "right");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${rightPercent}%` }}
        title="Right margin"
      />
    </div>
  );
}

function DocxMarginInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      {label}
      <input
        type="number"
        min={0}
        max={4}
        step={0.1}
        value={twipsToInches(value ?? TWIPS_PER_INCH)}
        onChange={(event) => onChange(inchesToTwips(Number(event.target.value)))}
        className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
      />
    </label>
  );
}

function docxPageStyle(page: DocxPageSettings | undefined): CSSProperties {
  const width = page?.width ? twipsToCssPixels(page.width) : 816;
  const minHeight = page?.height ? twipsToCssPixels(page.height) : 980;
  return {
    width,
    minHeight,
    paddingTop:
      page?.marginTop !== undefined ? twipsToCssPixels(page.marginTop) : 64,
    paddingRight:
      page?.marginRight !== undefined ? twipsToCssPixels(page.marginRight) : 80,
    paddingBottom:
      page?.marginBottom !== undefined ? twipsToCssPixels(page.marginBottom) : 64,
    paddingLeft:
      page?.marginLeft !== undefined ? twipsToCssPixels(page.marginLeft) : 80,
  };
}

function headingFontSize(level: number) {
  return DOCX_HEADING_FONT_SIZES[level] ?? DOCX_HEADING_FONT_SIZES[1];
}

function docxPagePresetValue(page: DocxPageSettings | undefined) {
  const width = page?.width ?? DOCX_PAGE_PRESETS[0].width;
  const height = page?.height ?? DOCX_PAGE_PRESETS[0].height;
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);
  return (
    DOCX_PAGE_PRESETS.find(
      (preset) =>
        preset.width === portraitWidth && preset.height === portraitHeight,
    )?.value ?? "custom"
  );
}

function DocxTextPartsPanel({
  headers,
  footers,
  comments,
  footnotes,
  endnotes,
  onHeaderChange,
  onFooterChange,
  onCommentChange,
  onFootnoteChange,
  onEndnoteChange,
}: {
  headers: DocxTextPart[];
  footers: DocxTextPart[];
  comments: DocxComment[];
  footnotes: DocxNote[];
  endnotes: DocxNote[];
  onHeaderChange: (index: number, text: string) => void;
  onFooterChange: (index: number, text: string) => void;
  onCommentChange: (index: number, patch: Partial<DocxComment>) => void;
  onFootnoteChange: (index: number, text: string) => void;
  onEndnoteChange: (index: number, text: string) => void;
}) {
  return (
    <div className="grid shrink-0 gap-3 border-b border-[var(--border)] bg-[var(--surface)] p-3 lg:grid-cols-2 xl:grid-cols-5">
      <DocxTextPartGroup
        title="Headers"
        emptyLabel="No existing headers"
        parts={headers}
        onChange={onHeaderChange}
      />
      <DocxTextPartGroup
        title="Footers"
        emptyLabel="No existing footers"
        parts={footers}
        onChange={onFooterChange}
      />
      <DocxCommentGroup comments={comments} onChange={onCommentChange} />
      <DocxNoteGroup
        title="Footnotes"
        emptyLabel="No existing footnotes"
        notes={footnotes}
        onChange={onFootnoteChange}
      />
      <DocxNoteGroup
        title="Endnotes"
        emptyLabel="No existing endnotes"
        notes={endnotes}
        onChange={onEndnoteChange}
      />
    </div>
  );
}

function DocxTextPartGroup({
  title,
  emptyLabel,
  parts,
  onChange,
}: {
  title: string;
  emptyLabel: string;
  parts: DocxTextPart[];
  onChange: (index: number, text: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</div>
      <div className="space-y-2">
        {parts.map((part, index) => (
          <label key={part.path} className="block">
            <span className="mb-1 block truncate font-mono text-[10px] text-[var(--text-faint)]">
              {part.path}
            </span>
            <textarea
              value={part.text}
              onChange={(event) => onChange(index, event.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        ))}
        {parts.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

function DocxCommentGroup({
  comments,
  onChange,
}: {
  comments: DocxComment[];
  onChange: (index: number, patch: Partial<DocxComment>) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">Comments</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {comments.map((comment, index) => (
          <div
            key={comment.id}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                #{comment.id}
              </span>
              <input
                value={comment.author ?? ""}
                onChange={(event) => onChange(index, { author: event.target.value })}
                placeholder="Author"
                className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            {comment.date && (
              <input
                value={comment.date}
                onChange={(event) => onChange(index, { date: event.target.value })}
                className="mb-2 h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-[10px] text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
            )}
            <textarea
              value={comment.text}
              onChange={(event) => onChange(index, { text: event.target.value })}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        ))}
        {comments.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            No existing comments
          </div>
        )}
      </div>
    </section>
  );
}

function DocxNoteGroup({
  title,
  emptyLabel,
  notes,
  onChange,
}: {
  title: string;
  emptyLabel: string;
  notes: DocxNote[];
  onChange: (index: number, text: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {notes.map((note, index) => (
          <label
            key={note.id}
            className="block rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <span className="mb-1 block font-mono text-[10px] text-[var(--text-faint)]">
              #{note.id}
            </span>
            <textarea
              value={note.text}
              onChange={(event) => onChange(index, event.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        ))}
        {notes.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

function DocxImageBlock({
  block,
  active,
  onFocus,
  onChange,
}: {
  block: DocxBlock;
  active: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<DocxBlock>) => void;
}) {
  const { t } = useTranslation();
  const width = Math.round(block.width ?? 320);
  const height = Math.round(block.height ?? 180);
  const aspect = width > 0 && height > 0 ? width / height : 1;

  function updateWidth(nextWidth: number) {
    const cleanWidth = clampImageDimension(nextWidth);
    onChange({ width: cleanWidth, height: clampImageDimension(cleanWidth / aspect) });
  }

  function updateHeight(nextHeight: number) {
    const cleanHeight = clampImageDimension(nextHeight);
    onChange({ height: cleanHeight, width: clampImageDimension(cleanHeight * aspect) });
  }

  return (
    <figure
      tabIndex={0}
      onFocus={onFocus}
      onClick={onFocus}
      className={cn(
        "group my-3 rounded-sm px-1 py-2 outline-none",
        active && "ring-1 ring-[var(--accent)]/40",
      )}
    >
      <div className="flex justify-center">
        {block.dataUrl ? (
          <img
            src={block.dataUrl}
            alt={block.altText ?? ""}
            className="max-w-full rounded-sm border border-neutral-200 object-contain"
            style={{ width, height }}
            draggable={false}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-sm border border-dashed border-neutral-300 text-neutral-500"
            style={{ width, height }}
          >
            <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
          </div>
        )}
      </div>
      {active && (
        <figcaption className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_96px_96px]">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                Alt
              </span>
              <input
                value={block.altText ?? ""}
                onChange={(event) => onChange({ altText: event.target.value })}
                placeholder={t("documentEditor.altText", {
                  defaultValue: "Alternative text",
                })}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                W
              </span>
              <input
                type="number"
                min={16}
                max={10_000}
                value={width}
                onChange={(event) => updateWidth(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                H
              </span>
              <input
                type="number"
                min={16}
                max={10_000}
                value={height}
                onChange={(event) => updateHeight(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>
          {block.mediaPath && (
            <div className="mt-1 truncate font-mono text-[10px] text-neutral-400">
              {block.mediaPath}
            </div>
          )}
        </figcaption>
      )}
    </figure>
  );
}

function DocxTableBlock({
  block,
  active,
  onFocus,
  onCellChange,
  onAddRow,
  onAddColumn,
  onInsertRow,
  onInsertColumn,
  onDuplicateRow,
  onDuplicateColumn,
  onMoveRow,
  onMoveColumn,
  onDeleteRow,
  onDeleteColumn,
  onClearCell,
  onPasteCells,
}: {
  block: DocxBlock;
  active: boolean;
  onFocus: () => void;
  onCellChange: (row: number, column: number, value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onInsertRow: (row: number, position: "above" | "below") => void;
  onInsertColumn: (column: number, position: "left" | "right") => void;
  onDuplicateRow: (row: number) => void;
  onDuplicateColumn: (column: number) => void;
  onMoveRow: (row: number, direction: -1 | 1) => void;
  onMoveColumn: (column: number, direction: -1 | 1) => void;
  onDeleteRow: (row: number) => void;
  onDeleteColumn: (column: number) => void;
  onClearCell: (row: number, column: number) => void;
  onPasteCells: (row: number, column: number, matrix: string[][]) => void;
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(
    null,
  );
  const rows = block.rows && block.rows.length > 0 ? block.rows : [[""]];
  const columns = tableColumnCount(rows);
  const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
  const selectedCell = clampTableCell(activeCell, normalizedRows.length, columns);

  function selectCell(row: number, column: number) {
    setActiveCell({ row, column });
    onFocus();
  }

  function focusCell(row: number, column: number) {
    const target = clampTableCell({ row, column }, normalizedRows.length, columns);
    if (!target) return;
    setActiveCell(target);
    requestAnimationFrame(() => {
      const textarea = tableRef.current?.querySelector<HTMLTextAreaElement>(
        `textarea[data-docx-cell="${target.row}:${target.column}"]`,
      );
      textarea?.focus();
      textarea?.select();
    });
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
    columnIndex: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const linearIndex = rowIndex * columns + columnIndex + direction;
      if (linearIndex < 0) {
        focusCell(0, 0);
        return;
      }
      if (linearIndex >= normalizedRows.length * columns) {
        onInsertRow(rowIndex, "below");
        focusCell(rowIndex + 1, 0);
        return;
      }
      focusCell(Math.floor(linearIndex / columns), linearIndex % columns);
      return;
    }
    if (primary && event.key === "Enter") {
      event.preventDefault();
      onInsertRow(rowIndex, event.shiftKey ? "above" : "below");
      focusCell(event.shiftKey ? rowIndex : rowIndex + 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      onMoveRow(rowIndex, -1);
      focusCell(rowIndex - 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      onMoveRow(rowIndex, 1);
      focusCell(rowIndex + 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      onMoveColumn(columnIndex, -1);
      focusCell(rowIndex, columnIndex - 1);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      onMoveColumn(columnIndex, 1);
      focusCell(rowIndex, columnIndex + 1);
    }
  }

  function handleCellPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
    columnIndex: number,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n") && !text.includes("\r")) return;
    event.preventDefault();
    const matrix = tableClipboardMatrix(text);
    onPasteCells(rowIndex, columnIndex, matrix);
    const lastRow = rowIndex + Math.max(0, matrix.length - 1);
    const lastColumn =
      columnIndex + Math.max(0, Math.max(...matrix.map((row) => row.length)) - 1);
    focusCell(lastRow, lastColumn);
  }

  const rowActionDisabled = !selectedCell;
  const columnActionDisabled = !selectedCell;

  return (
    <div
      ref={tableRef}
      className={cn(
        "mb-4 rounded-sm p-1",
        active && "ring-1 ring-[var(--accent)]/30",
      )}
      onFocus={onFocus}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1">
        <span className="px-1 text-[11px] font-medium text-neutral-500">Row</span>
        <DocxTableActionButton icon={ArrowUp} label="Insert row above" onClick={() => selectedCell && onInsertRow(selectedCell.row, "above")} disabled={rowActionDisabled} />
        <DocxTableActionButton icon={ArrowDown} label="Insert row below" onClick={() => selectedCell ? onInsertRow(selectedCell.row, "below") : onAddRow()} />
        <DocxTableActionButton icon={Copy} label="Duplicate row" onClick={() => selectedCell && onDuplicateRow(selectedCell.row)} disabled={rowActionDisabled} />
        <DocxTableActionButton icon={ChevronUp} label="Move row up" onClick={() => selectedCell && onMoveRow(selectedCell.row, -1)} disabled={!selectedCell || selectedCell.row <= 0} />
        <DocxTableActionButton icon={ChevronDown} label="Move row down" onClick={() => selectedCell && onMoveRow(selectedCell.row, 1)} disabled={!selectedCell || selectedCell.row >= normalizedRows.length - 1} />
        <DocxTableActionButton icon={Trash2} label="Delete row" onClick={() => selectedCell && onDeleteRow(selectedCell.row)} disabled={!selectedCell || normalizedRows.length <= 1} danger />
        <div className="mx-1 h-5 w-px bg-neutral-200" />
        <span className="px-1 text-[11px] font-medium text-neutral-500">Column</span>
        <DocxTableActionButton icon={ArrowLeft} label="Insert column left" onClick={() => selectedCell && onInsertColumn(selectedCell.column, "left")} disabled={columnActionDisabled} />
        <DocxTableActionButton icon={ArrowRight} label="Insert column right" onClick={() => selectedCell ? onInsertColumn(selectedCell.column, "right") : onAddColumn()} />
        <DocxTableActionButton icon={Copy} label="Duplicate column" onClick={() => selectedCell && onDuplicateColumn(selectedCell.column)} disabled={columnActionDisabled} />
        <DocxTableActionButton icon={ArrowLeft} label="Move column left" onClick={() => selectedCell && onMoveColumn(selectedCell.column, -1)} disabled={!selectedCell || selectedCell.column <= 0} />
        <DocxTableActionButton icon={ArrowRight} label="Move column right" onClick={() => selectedCell && onMoveColumn(selectedCell.column, 1)} disabled={!selectedCell || selectedCell.column >= columns - 1} />
        <DocxTableActionButton icon={Trash2} label="Delete column" onClick={() => selectedCell && onDeleteColumn(selectedCell.column)} disabled={!selectedCell || columns <= 1} danger />
        <div className="mx-1 h-5 w-px bg-neutral-200" />
        <DocxTableActionButton icon={Eraser} label="Clear cell" onClick={() => selectedCell && onClearCell(selectedCell.row, selectedCell.column)} disabled={!selectedCell} />
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-8 border border-neutral-300 bg-neutral-50" />
            {Array.from({ length: columns }, (_, columnIndex) => (
              <th
                key={columnIndex}
                className={cn(
                  "border border-neutral-300 bg-neutral-50 px-1 py-1 text-center text-[11px] font-medium text-neutral-500",
                  selectedCell?.column === columnIndex && "bg-lime-50 text-lime-700",
                )}
              >
                <button
                  type="button"
                  onClick={() => focusCell(selectedCell?.row ?? 0, columnIndex)}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-neutral-100"
                  title="Select column"
                >
                  {columnName(columnIndex)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th
                className={cn(
                  "border border-neutral-300 bg-neutral-50 px-1 py-1 text-[11px] font-medium text-neutral-500",
                  selectedCell?.row === rowIndex && "bg-lime-50 text-lime-700",
                )}
              >
                <button
                  type="button"
                  onClick={() => focusCell(rowIndex, selectedCell?.column ?? 0)}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-neutral-100"
                  title="Select row"
                >
                  {rowIndex + 1}
                </button>
              </th>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={cn(
                    "border border-neutral-300 p-0",
                    selectedCell?.row === rowIndex &&
                      selectedCell.column === columnIndex &&
                      "bg-lime-50",
                  )}
                >
                  <textarea
                    value={cell}
                    data-docx-cell={`${rowIndex}:${columnIndex}`}
                    onFocus={() => selectCell(rowIndex, columnIndex)}
                    onKeyDown={(event) =>
                      handleCellKeyDown(event, rowIndex, columnIndex)
                    }
                    onPaste={(event) =>
                      handleCellPaste(event, rowIndex, columnIndex)
                    }
                    onChange={(event) =>
                      onCellChange(rowIndex, columnIndex, event.target.value)
                    }
                    className="min-h-10 w-full resize-y bg-transparent px-2 py-1 text-sm leading-5 outline-none focus:bg-white"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocxTableActionButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30",
        danger && "hover:bg-red-50 hover:text-red-600",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

function tableColumnCount(rows: string[][]) {
  return Math.max(1, ...rows.map((row) => row.length));
}

function normalizeDocxTableRow(row: string[], columnCount: number) {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

function clampTableCell(
  cell: { row: number; column: number } | null,
  rowCount: number,
  columnCount: number,
) {
  if (!cell) return null;
  return {
    row: Math.max(0, Math.min(rowCount - 1, cell.row)),
    column: Math.max(0, Math.min(columnCount - 1, cell.column)),
  };
}

function tableClipboardMatrix(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((row) => row.split("\t"));
}

function pointsToTwips(points: number) {
  if (!Number.isFinite(points)) return 0;
  return Math.max(0, Math.round(points * 20));
}

function twipsToPoints(twips: number) {
  return Math.round((twips / 20) * 10) / 10;
}

function inchesToTwips(inches: number) {
  if (!Number.isFinite(inches)) return 0;
  return Math.max(0, Math.round(inches * TWIPS_PER_INCH));
}

function twipsToInches(twips: number) {
  return Math.round((twips / TWIPS_PER_INCH) * 10) / 10;
}

function twipsToCssPixels(twips: number) {
  return (twips / 20) * (4 / 3);
}

function clampImageDimension(value: number) {
  if (!Number.isFinite(value)) return 16;
  return Math.max(16, Math.min(10_000, Math.round(value)));
}

function readImageDisplaySize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth || 320;
      const naturalHeight = image.naturalHeight || 180;
      const maxWidth = 520;
      const scale = naturalWidth > maxWidth ? maxWidth / naturalWidth : 1;
      resolve({
        width: clampImageDimension(naturalWidth * scale),
        height: clampImageDimension(naturalHeight * scale),
      });
    };
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = dataUrl;
  });
}

function isDocxTextBlock(
  block: DocxBlock | undefined,
): block is DocxBlock & { type: "paragraph" | "heading" } {
  return block?.type === "paragraph" || block?.type === "heading";
}

function pickDocxFormatting(block: DocxBlock): DocxFormatClipboard {
  return Object.fromEntries(
    DOCX_FORMAT_KEYS.map((key) => [key, block[key]]).filter(
      ([, value]) => value !== undefined,
    ),
  ) as DocxFormatClipboard;
}

function sectionBreakLabel(kind: DocxBlock["breakKind"]) {
  if (kind === "continuous") return "continuous";
  if (kind === "evenPage") return "even page";
  if (kind === "oddPage") return "odd page";
  return "next page";
}

function nextDocxBlockId(
  blocks: DocxBlock[],
  prefix: "p" | "tbl" | "img" | "br" | "sect",
) {
  return allocateDocxBlockId(new Set(blocks.map((block) => block.id)), prefix);
}

function allocateDocxBlockId(
  usedIds: Set<string>,
  prefix: "p" | "tbl" | "img" | "br" | "sect",
) {
  let index = usedIds.size + 1;
  let id = `${prefix}${index}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  usedIds.add(id);
  return id;
}

function textOffsetWithin(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return element.textContent?.length ?? 0;
  }
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) {
    return element.textContent?.length ?? 0;
  }
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function focusDocxBlock(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-docx-block="${CSS.escape(id)}"]`,
  );
  if (!element) return;
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
