import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import {
  DOCX_PAGE_PRESETS,
  docxPageStyle,
  focusDocxBlock,
  headingFontSize,
  isDocxTextBlock,
  nextDocxCommentId,
  nextDocxBlockId,
  nextDocxNoteId,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRowHeights,
  pickDocxFormatting,
  readImageDisplaySize,
  sectionBreakLabel,
  textSelectionOffsetsWithin,
  textOffsetWithin,
} from "../docxEditorUtils";
import type { DocxFormatClipboard } from "../docxEditorUtils";
import { buildDocxPasteResult } from "../docxRichPaste";
import {
  applyDocxInlineStyleRange,
  docxRenderableRuns,
  docxRunStyle,
  docxStyleForBlock,
  docxTextBlockStyle,
  docxTextEditPatch,
  isDocxInlineStylePatch,
  toggleDocxInlineBooleanRange,
} from "../docxTextRuns";
import { builtInFontFamilies } from "../fonts";
import type {
  DocxBlock,
  DocxComment,
  DocxContentControl,
  DocxModel,
  DocxPageSettings,
  DocxRevision,
} from "../models";
import {
  DocxImageBlock,
  DocxRuler,
  DocxTableBlock,
  DocxTextPartsPanel,
} from "../docxEditorBlocks";
import { DocxEditorToolbar } from "../docxEditorToolbar";
import {
  addDocxTableColumn,
  addDocxTableRow,
  deleteDocxTableColumn,
  deleteDocxTableRow,
  duplicateDocxTableColumn,
  duplicateDocxTableRow,
  insertDocxTableColumn,
  insertDocxTableRow,
  mergeDocxTableCellDown,
  mergeDocxTableCellRight,
  moveDocxTableColumn,
  moveDocxTableRow,
  pasteDocxTableCells,
  resizeDocxTableColumn,
  resizeDocxTableRow,
  splitDocxTableCell,
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
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [formatClipboard, setFormatClipboard] =
    useState<DocxFormatClipboard | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const composingBlockIdRef = useRef<string | null>(null);
  const activeBlock =
    model.blocks.find((block) => block.id === activeBlockId) ?? model.blocks[0];
  const page = model.page;
  const hasDocumentParts = Boolean(
    model.headers?.length ||
      model.footers?.length ||
      model.comments?.length ||
      model.footnotes?.length ||
      model.endnotes?.length ||
      model.blocks.some(
        (block) =>
          block.fields?.length ||
          block.contentControls?.length ||
          block.revisions?.length,
      ),
  );
  const outlineItems = model.blocks
    .map((block, index) => {
      if (block.type === "heading") {
        return {
          id: block.id,
          index,
          label:
            block.bookmarkName ??
            (block.text.trim() || `Heading ${block.headingLevel ?? 1}`),
          kind: `Heading ${block.headingLevel ?? 1}`,
          level: block.headingLevel ?? 1,
        };
      }
      if (block.bookmarkName) {
        return {
          id: block.id,
          index,
          label: block.bookmarkName,
          kind: "Bookmark",
          level: 1,
        };
      }
      if (block.type === "table") {
        return { id: block.id, index, label: "Table", kind: "Table", level: 1 };
      }
      if (block.type === "image") {
        return {
          id: block.id,
          index,
          label: block.altText?.trim() || "Image",
          kind: "Image",
          level: 1,
        };
      }
      if (block.type === "pageBreak" || block.type === "sectionBreak") {
        return {
          id: block.id,
          index,
          label:
            block.type === "pageBreak"
              ? "Page break"
              : `Section break (${sectionBreakLabel(block.breakKind)})`,
          kind: block.type === "pageBreak" ? "Page" : "Section",
          level: 1,
        };
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

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

  function updateFieldInstruction(
    blockIndex: number,
    fieldIndex: number,
    instruction: string,
  ) {
    const block = model.blocks[blockIndex];
    const field = block?.fields?.[fieldIndex];
    if (!block || !field || field.source !== "simple") return;
    updateBlock(blockIndex, {
      fields: block.fields?.map((item, index) =>
        index === fieldIndex ? { ...item, instruction } : item,
      ),
    });
  }

  function updateContentControl(
    blockIndex: number,
    controlIndex: number,
    patch: Partial<DocxContentControl>,
  ) {
    const block = model.blocks[blockIndex];
    const control = block?.contentControls?.[controlIndex];
    if (!block || !control) return;
    updateBlock(blockIndex, {
      contentControls: block.contentControls?.map((item, index) =>
        index === controlIndex ? { ...item, ...patch } : item,
      ),
    });
  }

  function updateRevisionAction(
    blockIndex: number,
    revisionIndex: number,
    action: DocxRevision["action"],
  ) {
    const block = model.blocks[blockIndex];
    const revision = block?.revisions?.[revisionIndex];
    if (!block || !revision) return;
    updateBlock(blockIndex, {
      revisions: block.revisions?.map((item, index) =>
        index === revisionIndex ? { ...item, action } : item,
      ),
    });
  }

  function applyInlineStyleToSelection(
    index: number,
    patch: Partial<DocxBlock>,
  ) {
    const block = model.blocks[index];
    if (!isDocxTextBlock(block) || !isDocxInlineStylePatch(patch)) return false;
    const element = document.querySelector<HTMLElement>(
      `[data-docx-block="${CSS.escape(block.id)}"]`,
    );
    if (!element) return false;
    const range = textSelectionOffsetsWithin(element);
    if (!range || range.start === range.end) return false;
    const nextBlock = applyDocxInlineStyleRange(
      block,
      range.start,
      range.end,
      patch,
    );
    if (!nextBlock) return false;
    updateBlock(index, nextBlock);
    return true;
  }

  function toggleInlineBooleanOrBlock(
    index: number,
    key: "bold" | "italic" | "underline" | "strikethrough",
  ) {
    const block = model.blocks[index];
    if (!isDocxTextBlock(block)) return;
    const element = document.querySelector<HTMLElement>(
      `[data-docx-block="${CSS.escape(block.id)}"]`,
    );
    const range = element ? textSelectionOffsetsWithin(element) : null;
    if (range && range.start !== range.end) {
      const nextBlock = toggleDocxInlineBooleanRange(
        block,
        range.start,
        range.end,
        key,
      );
      if (nextBlock) {
        updateBlock(index, nextBlock);
        return;
      }
    }
    updateBlock(index, { [key]: !block[key] });
  }

  function updateActive(patch: Partial<DocxBlock>) {
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    if (index >= 0 && !applyInlineStyleToSelection(index, patch)) {
      updateBlock(index, patch);
    }
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

  function insertCommentReference(blockIndex?: number) {
    const targetIndex =
      blockIndex ??
      model.blocks.findIndex((block) => block.id === activeBlock?.id);
    const block = model.blocks[targetIndex];
    if (!isDocxTextBlock(block)) return;
    const comments = model.comments ?? [];
    const commentId = block.commentId ?? nextDocxCommentId(comments, model.blocks);
    const commentExists = comments.some((comment) => comment.id === commentId);
    onChange({
      ...model,
      blocks: model.blocks.map((item, index) =>
        index === targetIndex ? { ...item, commentId } : item,
      ),
      comments: commentExists
        ? comments
        : [...comments, { id: commentId, text: "" }],
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

  function focusBlockById(blockId: string) {
    setActiveBlockId(blockId);
    requestAnimationFrame(() => focusDocxBlock(blockId));
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
          imageWrap: "inline",
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
      toggleInlineBooleanOrBlock(index, "bold");
    } else if (key === "i") {
      event.preventDefault();
      toggleInlineBooleanOrBlock(index, "italic");
    } else if (key === "u") {
      event.preventDefault();
      toggleInlineBooleanOrBlock(index, "underline");
    } else if (event.shiftKey && key === "x") {
      event.preventDefault();
      toggleInlineBooleanOrBlock(index, "strikethrough");
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
    } else if (event.altKey && key === "m") {
      event.preventDefault();
      insertCommentReference(index);
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
    const nextEnabled = current.listKind !== listKind;
    updateBlock(index, {
      type: "paragraph",
      headingLevel: undefined,
      fontSize: current.type === "heading" ? "14" : current.fontSize,
      listKind: nextEnabled ? listKind : undefined,
      listLevel: nextEnabled ? current.listLevel ?? 0 : undefined,
      listNumberingId: nextEnabled ? current.listNumberingId : undefined,
      listStart: nextEnabled && listKind === "number" ? current.listStart : undefined,
    });
  }

  function toggleActiveList(listKind: "bullet" | "number") {
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    if (index >= 0) toggleBlockList(index, listKind);
  }

  function adjustActiveIndent(delta: number) {
    if (activeBlock?.listKind) {
      const current = activeBlock.listLevel ?? 0;
      updateActive({ listLevel: Math.max(0, Math.min(8, current + Math.sign(delta))) });
      return;
    }
    const current = activeBlock?.indentLeft ?? 0;
    updateActive({ indentLeft: Math.max(0, current + delta) });
  }

  function continueActiveList() {
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    const block = model.blocks[index];
    if (index < 0 || block?.listKind !== "number") return;
    const previousNumbered = model.blocks
      .slice(0, index)
      .reverse()
      .find(
        (item) =>
          item.listKind === "number" &&
          (item.listLevel ?? 0) === (block.listLevel ?? 0),
      );
    updateBlock(index, {
      listNumberingId: previousNumbered?.listNumberingId,
      listStart: undefined,
    });
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
      runs: undefined,
      headingLevel: undefined,
      fontSize: block.type === "heading" ? "14" : block.fontSize,
    };
    replaceBlocks(
      model.blocks.flatMap((item, blockIndex) =>
        blockIndex === index ? [{ ...item, text: before, runs: undefined }, next] : [item],
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
          blockIndex === index - 1
            ? { ...block, text: mergedText, runs: undefined }
            : block,
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
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleInlineBooleanOrBlock(index, "bold");
    } else if (commandId === "italic") {
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleInlineBooleanOrBlock(index, "italic");
    } else if (commandId === "underline") {
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleInlineBooleanOrBlock(index, "underline");
    } else if (commandId === "link") {
      openLinkEditor();
    } else if (commandId === "normalStyle") {
      applyNormalStyle();
    } else if (commandId === "strikethrough") {
      const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
      if (index >= 0) toggleInlineBooleanOrBlock(index, "strikethrough");
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
    } else if (commandId === "comment") {
      insertCommentReference();
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

  function pasteClipboardIntoBlock(
    index: number,
    element: HTMLElement,
    clipboardData: Pick<DataTransfer, "getData">,
  ) {
    const result = buildDocxPasteResult({
      blocks: model.blocks,
      blockIndex: index,
      element,
      clipboardData,
    });
    if (!result) return false;
    replaceBlocks(result.blocks, result.nextActiveId);
    return true;
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

  function mergeTableCellRight(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = model.blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = mergeDocxTableCellRight(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function mergeTableCellDown(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = model.blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = mergeDocxTableCellDown(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function splitTableCell(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = model.blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = splitDocxTableCell(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
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

  function updateTableStyle(blockIndex: number, patch: Partial<DocxBlock>) {
    const block = model.blocks[blockIndex];
    if (block?.type !== "table") return;
    updateBlock(blockIndex, patch);
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
    const comment = comments[index];
    onChange({
      ...model,
      blocks: comment
        ? model.blocks.map((block) =>
            block.commentId === comment.id ? { ...block, commentId: undefined } : block,
          )
        : model.blocks,
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
      <DocxEditorToolbar
        activeBlock={activeBlock}
        page={page}
        linkInputOpen={linkInputOpen}
        linkDraft={linkDraft}
        canPasteFormatting={Boolean(formatClipboard)}
        hasDocumentParts={hasDocumentParts}
        textPartsOpen={textPartsOpen}
        outlineOpen={outlineOpen}
        imageInputRef={imageInputRef}
        paragraphStyles={model.styles ?? []}
        onUpdateActive={updateActive}
        onOpenLinkEditor={openLinkEditor}
        onApplyLinkDraft={applyLinkDraft}
        onSetLinkDraft={setLinkDraft}
        onApplyNormalStyle={applyNormalStyle}
        onCopyActiveFormatting={copyActiveFormatting}
        onPasteActiveFormatting={pasteActiveFormatting}
        onToggleActiveVerticalAlign={toggleActiveVerticalAlign}
        onAdjustActiveIndent={adjustActiveIndent}
        onToggleActiveList={toggleActiveList}
        onContinueActiveList={continueActiveList}
        onInsertCommentReference={insertCommentReference}
        onInsertNoteReference={insertNoteReference}
        onUpdatePagePreset={updatePagePreset}
        onUpdatePageOrientation={updatePageOrientation}
        onUpdatePage={updatePage}
        onToggleTextPartsOpen={() => setTextPartsOpen((current) => !current)}
        onToggleOutlineOpen={() => setOutlineOpen((current) => !current)}
        onMoveActiveBlock={moveActiveBlock}
        onDeleteActiveBlock={deleteActiveBlock}
        onInsertImageFile={insertImageFile}
        onAddBlock={addBlock}
        onInsertPageBreak={insertPageBreak}
        onInsertSectionBreak={insertSectionBreak}
      />
      {hasDocumentParts && textPartsOpen && (
        <DocxTextPartsPanel
          headers={model.headers ?? []}
          footers={model.footers ?? []}
          comments={model.comments ?? []}
          footnotes={model.footnotes ?? []}
          endnotes={model.endnotes ?? []}
          blocks={model.blocks}
          onHeaderChange={(index, text) => updateTextPart("headers", index, text)}
          onFooterChange={(index, text) => updateTextPart("footers", index, text)}
          onCommentChange={updateComment}
          onCommentDelete={deleteComment}
          onFootnoteChange={(index, text) => updateNote("footnotes", index, text)}
          onFootnoteDelete={(index) => deleteNote("footnotes", index)}
          onEndnoteChange={(index, text) => updateNote("endnotes", index, text)}
          onEndnoteDelete={(index) => deleteNote("endnotes", index)}
          onFieldInstructionChange={updateFieldInstruction}
          onContentControlChange={updateContentControl}
          onRevisionActionChange={updateRevisionAction}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {outlineOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
              <span className="text-xs font-semibold text-[var(--text)]">Outline</span>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                {t("common.close")}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {outlineItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
                  No outline entries.
                </div>
              ) : (
                <div className="space-y-1">
                  {outlineItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => focusBlockById(item.id)}
                      className={cn(
                        "block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]",
                        activeBlock?.id === item.id &&
                          "bg-[var(--surface-hover)] text-[var(--accent)]",
                      )}
                      style={{ paddingLeft: `${8 + Math.max(0, item.level - 1) * 12}px` }}
                    >
                      <div className="truncate text-xs font-medium text-[var(--text)]">
                        {item.label}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-faint)]">
                        <span>{item.kind}</span>
                        <span>#{item.index + 1}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
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
                  onStyleChange={(patch) => updateTableStyle(index, patch)}
                  onDeleteRow={(rowIndex) => deleteTableRow(index, rowIndex)}
                  onDeleteColumn={(columnIndex) =>
                    deleteTableColumn(index, columnIndex)
                  }
                  onClearCell={(rowIndex, columnIndex) =>
                    clearTableCell(index, rowIndex, columnIndex)
                  }
                  onMergeCellRight={(rowIndex, columnIndex) =>
                    mergeTableCellRight(index, rowIndex, columnIndex)
                  }
                  onMergeCellDown={(rowIndex, columnIndex) =>
                    mergeTableCellDown(index, rowIndex, columnIndex)
                  }
                  onSplitCell={(rowIndex, columnIndex) =>
                    splitTableCell(index, rowIndex, columnIndex)
                  }
                  onPasteCells={(rowIndex, columnIndex, matrix) =>
                    pasteTableCells(index, rowIndex, columnIndex, matrix)
                  }
                />
              );
            }
            const runs = docxRenderableRuns(block);
            const paragraphStyle = docxStyleForBlock(model.styles, block);
            return (
              <div key={block.id} className="relative">
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onFocus={() => setActiveBlockId(block.id)}
                  onCompositionStart={() => {
                    composingBlockIdRef.current = block.id;
                  }}
                  onCompositionEnd={(event) => {
                    composingBlockIdRef.current = null;
                    updateBlock(
                      index,
                      docxTextEditPatch(
                        block,
                        event.currentTarget.textContent ?? "",
                      ),
                    );
                  }}
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
                    if (
                      pasteClipboardIntoBlock(
                        index,
                        event.currentTarget,
                        event.clipboardData,
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                  onInput={(event) => {
                    if (composingBlockIdRef.current === block.id) return;
                    updateBlock(
                      index,
                      docxTextEditPatch(
                        block,
                        event.currentTarget.textContent ?? "",
                      ),
                    );
                  }}
                  data-docx-block={block.id}
                  className={cn(
                    "min-h-7 rounded-sm px-1 py-1 outline-none",
                    isActive && "ring-1 ring-[var(--accent)]/30",
                    block.type === "heading" ? "mb-3 mt-4 font-semibold" : "mb-2 leading-7",
                    block.pageBreakBefore &&
                      "mt-8 border-t border-dashed border-neutral-300 pt-4",
                  )}
                  style={docxTextBlockStyle(block, paragraphStyle)}
                >
                  {runs
                    ? runs.map((run, runIndex) => (
                        <span key={`${block.id}-run-${runIndex}`} style={docxRunStyle(run)}>
                          {run.text}
                        </span>
                      ))
                    : block.text}
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
    </div>
  );
}
