import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EditorCommandRequest } from "../shared/commands";
import {
  DOCX_PAGE_PRESETS,
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
  textSelectionOffsetsWithin,
  textOffsetWithin,
} from "../word/docxEditorUtils";
import type { DocxFormatClipboard } from "../word/docxEditorUtils";
import { buildDocxPasteResult } from "../word/docxRichPaste";
import {
  applyDocxInlineStyleRange,
  isDocxInlineStylePatch,
  mergeDocxTextBlockRuns,
  splitDocxTextBlockRuns,
  docxTextEditingBlockReason,
  toggleDocxInlineBooleanRange,
} from "../word/docxTextRuns";
import { builtInFontFamilies } from "../shared/fonts";
import type {
  DocxBlock,
  DocxModel,
  DocxPageSettings,
  DocxStyle,
} from "../shared/models";
import { DocxTextPartsPanel } from "../word/docxTextPartsPanel";
import { DocxEditorToolbar } from "../word/docxEditorToolbar";
import { DocxStylePanel } from "../word/docxStylePanel";
import { createDocxTableActions } from "../word/docxTableActions";
import { DocxOutlinePanel } from "../word/docxOutline";
import { buildDocxOutlineItems } from "../word/docxOutlineModel";
import { DocxDocumentCanvas } from "../word/docxDocumentCanvas";
import { createDocxPartsActions } from "../word/docxPartsActions";
import { runDocxEditorCommand } from "../word/docxEditorCommands";
import { handleDocxBlockShortcut } from "../word/docxBlockShortcuts";
import { insertDocxBlockAtStableAnchor } from "../word/docxAsyncInsertion";
import { deleteDocxBlockAndUnreferencedParts } from "../word/docxReferenceCleanup";
import {
  addDocxCommentRange,
  docxHyperlinkRanges,
  docxNoteReferences,
  setDocxHyperlinkRange,
} from "../word/docxTextAnchors";
import {
  applyDocxPageDraft,
  docxPageDraftEquals,
  resolveDocxPageDraftTarget,
} from "../word/docxPageDraft";

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
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    model.blocks[0]?.id ?? null,
  );
  const [textPartsOpen, setTextPartsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [pendingLinkSelection, setPendingLinkSelection] = useState<{
    blockId: string;
    start: number;
    end: number;
  } | null>(null);
  const [formatClipboard, setFormatClipboard] =
    useState<DocxFormatClipboard | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const initialPageTarget = resolveDocxPageDraftTarget(model, activeBlockId);
  const [storedPageDraftTarget, setStoredPageDraftTarget] = useState(initialPageTarget);
  const [pageDraft, setPageDraft] = useState<DocxPageSettings>(initialPageTarget.page);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageReadersRef = useRef(new Map<string, FileReader>());
  const pendingImageSequenceRef = useRef(0);
  const latestModelRef = useRef(model);
  const handledCommandTokenRef = useRef<number | null>(null);
  const composingBlockIdRef = useRef<string | null>(null);
  const pageOrientationDimensionsRef = useRef<{
    targetId: string;
    portrait?: { width?: number; height?: number };
    landscape?: { width?: number; height?: number };
  }>({ targetId: initialPageTarget.id });
  const activeBlock =
    model.blocks.find((block) => block.id === activeBlockId) ?? model.blocks[0];
  const storedPageDraftDirty = !docxPageDraftEquals(
    storedPageDraftTarget.page,
    pageDraft,
  );
  const resolvedPageDraftTarget = resolveDocxPageDraftTarget(model, activeBlockId);
  const pageDraftTarget = storedPageDraftDirty
    ? storedPageDraftTarget
    : resolvedPageDraftTarget;
  const page = storedPageDraftDirty ? pageDraft : resolvedPageDraftTarget.page;
  const pageDraftDirty = storedPageDraftDirty;
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
  const outlineItems = buildDocxOutlineItems(model.blocks);

  useEffect(() => {
    latestModelRef.current = model;
  }, [model]);

  function updatePage(patch: Partial<DocxPageSettings>) {
    if (!storedPageDraftDirty) {
      setStoredPageDraftTarget(resolvedPageDraftTarget);
      setPageDraft({ ...resolvedPageDraftTarget.page, ...patch });
      resetPageOrientationMemory(
        resolvedPageDraftTarget.id,
        resolvedPageDraftTarget.page,
      );
      return;
    }
    setPageDraft((current) => ({ ...current, ...patch }));
  }

  function updatePageOrientation(orientation: "portrait" | "landscape") {
    const current = page;
    if (pageOrientationDimensionsRef.current.targetId !== pageDraftTarget.id) {
      resetPageOrientationMemory(pageDraftTarget.id, current);
    }
    const currentOrientation = current.orientation ?? "portrait";
    pageOrientationDimensionsRef.current[currentOrientation] = {
      width: current.width,
      height: current.height,
    };
    const remembered = pageOrientationDimensionsRef.current[orientation];
    const shouldSwap =
      current?.width !== undefined &&
      current.height !== undefined &&
      ((orientation === "landscape" && current.width < current.height) ||
        (orientation === "portrait" && current.width > current.height));
    updatePage({
      orientation,
      width: remembered?.width ?? (shouldSwap ? current?.height : current?.width),
      height: remembered?.height ?? (shouldSwap ? current?.width : current?.height),
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
    pageOrientationDimensionsRef.current[orientation] = {
      width: orientation === "landscape" ? preset.height : preset.width,
      height: orientation === "landscape" ? preset.width : preset.height,
    };
  }

  function applyPageDraft() {
    if (!pageDraftDirty) return;
    if (
      pageDraftTarget.breakBlockId &&
      !model.blocks.some((block) => block.id === pageDraftTarget.breakBlockId)
    ) {
      setInteractionError(
        "Page settings were not applied because the target section break no longer exists.",
      );
      return;
    }
    const committedPage = { ...pageDraft };
    const nextModel = applyDocxPageDraft(model, pageDraftTarget, committedPage);
    setStoredPageDraftTarget({ ...pageDraftTarget, page: committedPage });
    resetPageOrientationMemory(pageDraftTarget.id, committedPage);
    setInteractionError(null);
    onChange(nextModel);
  }

  function cancelPageDraft() {
    setPageDraft({ ...pageDraftTarget.page });
    resetPageOrientationMemory(pageDraftTarget.id, pageDraftTarget.page);
  }

  function resetPageOrientationMemory(targetId: string, value: DocxPageSettings) {
    const orientation = value.orientation ?? "portrait";
    pageOrientationDimensionsRef.current = {
      targetId,
      [orientation]: { width: value.width, height: value.height },
    };
  }

  function updateBlock(index: number, patch: Partial<DocxBlock>) {
    onChange({
      ...model,
      blocks: model.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } : block,
      ),
    });
  }

  function updateParagraphStyle(styleId: string, patch: Partial<DocxStyle>) {
    const styles = model.styles ?? [];
    onChange({
      ...model,
      styles: styles.map((style) =>
        style.id === styleId ? { ...style, ...patch } : style,
      ),
      blocks:
        patch.name === undefined
          ? model.blocks
          : model.blocks.map((block) =>
              block.paragraphStyleId === styleId
                ? { ...block, paragraphStyleName: patch.name }
                : block,
            ),
    });
  }

  function deleteParagraphStyle(styleId: string) {
    const styles = model.styles ?? [];
    const style = styles.find((item) => item.id === styleId);
    if (!style?.custom) return;
    onChange({
      ...model,
      styles: styles.filter((item) => item.id !== styleId),
      blocks: model.blocks.map((block) =>
        block.paragraphStyleId === styleId
          ? {
              ...block,
              paragraphStyleId: undefined,
              paragraphStyleName: undefined,
            }
          : block,
      ),
    });
  }

  function createParagraphStyleFromActive(name: string) {
    if (!isDocxTextBlock(activeBlock)) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    const styleId = nextParagraphStyleId(model.styles ?? [], cleanName);
    const style: DocxStyle = {
      id: styleId,
      name: cleanName,
      type: "paragraph",
      custom: true,
      quickFormat: true,
      basedOn: activeBlock.paragraphStyleId,
      next: activeBlock.paragraphStyleId,
      bold: activeBlock.bold,
      italic: activeBlock.italic,
      underline: activeBlock.underline,
      strikethrough: activeBlock.strikethrough,
      verticalAlign: activeBlock.verticalAlign,
      fontFamily: activeBlock.fontFamily,
      fontSize: activeBlock.fontSize,
      color: activeBlock.color,
      highlight: activeBlock.highlight,
      align: activeBlock.align,
    };
    onChange({
      ...model,
      styles: [...(model.styles ?? []), style],
      blocks: model.blocks.map((block) =>
        block.id === activeBlock.id
          ? {
              ...block,
              paragraphStyleId: styleId,
              paragraphStyleName: cleanName,
            }
          : block,
      ),
    });
  }

  const {
    addTableColumn,
    addTableRow,
    clearTableCell,
    deleteTableColumn,
    deleteTableRow,
    duplicateTableColumn,
    duplicateTableRow,
    insertTableColumn,
    insertTableRow,
    mergeTableCellDown,
    mergeTableCellRight,
    moveTableColumn,
    moveTableRow,
    pasteTableCells,
    splitTableCell,
    updateTableCell,
    updateTableColumnWidth,
    updateTableRowHeight,
    updateTableStyle,
  } = createDocxTableActions({
    blocks: model.blocks,
    updateBlock,
  });
  const {
    deleteComment,
    deleteNote,
    updateComment,
    updateContentControl,
    updateFieldInstruction,
    updateNote,
    updateRevisionAction,
    updateTextPart,
  } = createDocxPartsActions({
    model,
    onChange,
    onMutationError: setInteractionError,
    updateBlock,
  });

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
    const editingBlockReason = docxTextEditingBlockReason(block);
    if (editingBlockReason) {
      setInteractionError(`Formatting was not changed. ${editingBlockReason}`);
      return;
    }
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
    if (activeBlock) {
      const editingBlockReason = docxTextEditingBlockReason(activeBlock);
      if (editingBlockReason) {
        setInteractionError(`Paragraph formatting was not changed. ${editingBlockReason}`);
        return;
      }
    }
    const index = model.blocks.findIndex((block) => block.id === activeBlock?.id);
    if (index >= 0 && !applyInlineStyleToSelection(index, patch)) {
      updateBlock(index, patch);
    }
  }

  function openLinkEditor() {
    if (!isDocxTextBlock(activeBlock)) return;
    const range = docxBlockTextSelection(activeBlock) ?? {
      start: 0,
      end: activeBlock.text.length,
    };
    if (range.start === range.end) {
      setInteractionError("Select text before changing a link.");
      return;
    }
    setInteractionError(null);
    const selectedLink = docxHyperlinkRanges(activeBlock).find(
      (link) => link.start <= range.start && link.end >= range.end,
    );
    setPendingLinkSelection({ blockId: activeBlock.id, ...range });
    setLinkDraft(selectedLink?.target ?? "");
    setLinkInputOpen(true);
  }

  function applyLinkDraft() {
    if (!pendingLinkSelection) return;
    const blockIndex = model.blocks.findIndex(
      (block) => block.id === pendingLinkSelection.blockId,
    );
    const block = model.blocks[blockIndex];
    if (!isDocxTextBlock(block)) {
      setInteractionError("The paragraph selected for the link no longer exists.");
      setLinkInputOpen(false);
      setPendingLinkSelection(null);
      return;
    }
    const target = linkDraft.trim();
    const result = setDocxHyperlinkRange(
      block,
      pendingLinkSelection,
      target || undefined,
    );
    if ("reason" in result) {
      setInteractionError(result.reason);
      return;
    }
    updateBlock(blockIndex, result.block);
    setInteractionError(null);
    setLinkInputOpen(false);
    setPendingLinkSelection(null);
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
    const notes = model[noteKey] ?? [];
    const offset = docxBlockTextSelection(block)?.end ?? block.text.length;
    const existing = docxNoteReferences(block).find(
      (reference) => reference.kind === kind && reference.offset === offset,
    );
    const blockKey = kind === "footnote" ? "footnoteId" : "endnoteId";
    const noteId = existing?.id ?? nextDocxNoteId(notes, model.blocks, blockKey);
    const noteExists = notes.some((note) => note.id === noteId);
    onChange({
      ...model,
      blocks: model.blocks.map((item, index) =>
        index === targetIndex
          ? {
              ...item,
              footnoteId: undefined,
              endnoteId: undefined,
              noteReferences: existing
                ? docxNoteReferences(block)
                : [
                    ...docxNoteReferences(block),
                    { id: noteId, kind, offset, affinity: "after" as const },
                  ],
            }
          : item,
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
    const range = docxBlockTextSelection(block) ?? {
      start: 0,
      end: block.text.length,
    };
    const comments = model.comments ?? [];
    const commentId = nextDocxCommentId(comments, model.blocks);
    const result = addDocxCommentRange(block, range, commentId);
    if ("reason" in result) {
      setInteractionError(result.reason);
      return;
    }
    setInteractionError(null);
    const commentExists = comments.some((comment) => comment.id === commentId);
    onChange({
      ...model,
      blocks: model.blocks.map((item, index) =>
        index === targetIndex ? result.block : item,
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

  /**
   * Media reads carry only a stable block anchor. Completion rebases onto the
   * latest model and remains explicitly cancellable while no package reference
   * exists, preventing a stale FileReader closure from replacing later edits.
   */
  function insertImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    pendingImageSequenceRef.current += 1;
    const operationId = `docx-image-${pendingImageSequenceRef.current}`;
    const anchorBlockId = activeBlock?.id ?? null;
    const reader = new FileReader();
    pendingImageReadersRef.current.set(operationId, reader);
    setPendingImages((current) => [
      ...current,
      { id: operationId, name: file.name },
    ]);
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        finishPendingImage(operationId);
        return;
      }
      void readImageDisplaySize(dataUrl)
        .then(({ width, height }) => {
          if (!pendingImageReadersRef.current.has(operationId)) return;
          const latest = latestModelRef.current;
          const nextBlock: DocxBlock = {
            id: nextDocxBlockId(latest.blocks, "img"),
            type: "image",
            text: "",
            dataUrl,
            mimeType: file.type,
            altText: file.name,
            width,
            height,
            imageWrap: "inline",
          };
          const rebased = insertDocxBlockAtStableAnchor(
            latest,
            anchorBlockId,
            nextBlock,
          );
          if ("reason" in rebased) {
            setInteractionError(
              `Image ${file.name} was not inserted because its paragraph was deleted.`,
            );
            finishPendingImage(operationId);
            return;
          }
          const nextModel = rebased.model;
          latestModelRef.current = nextModel;
          onChange(nextModel);
          setActiveBlockId(nextBlock.id);
          setInteractionError(null);
          finishPendingImage(operationId);
        })
        .catch(() => {
          if (!pendingImageReadersRef.current.has(operationId)) return;
          setInteractionError(`Image ${file.name} could not be decoded.`);
          finishPendingImage(operationId);
        });
    };
    reader.onerror = () => {
      setInteractionError(`Image ${file.name} could not be read.`);
      finishPendingImage(operationId);
    };
    reader.onabort = () => {
      if (pendingImageReadersRef.current.has(operationId)) {
        finishPendingImage(operationId);
      }
    };
    reader.readAsDataURL(file);
  }

  function finishPendingImage(operationId: string) {
    pendingImageReadersRef.current.delete(operationId);
    setPendingImages((current) =>
      current.filter((operation) => operation.id !== operationId),
    );
  }

  function cancelPendingImage(operationId: string) {
    const reader = pendingImageReadersRef.current.get(operationId);
    pendingImageReadersRef.current.delete(operationId);
    if (reader?.readyState === FileReader.LOADING) reader.abort();
    setPendingImages((current) =>
      current.filter((operation) => operation.id !== operationId),
    );
  }

  useEffect(
    () => () => {
      const readers = [...pendingImageReadersRef.current.values()];
      pendingImageReadersRef.current.clear();
      for (const reader of readers) {
        if (reader.readyState === FileReader.LOADING) reader.abort();
      }
    },
    [],
  );

  function deleteActiveBlock() {
    if (!activeBlock) return;
    const nextModel = deleteDocxBlockAndUnreferencedParts(model, activeBlock.id);
    onChange(nextModel);
    setActiveBlockId(nextModel.blocks[0]?.id ?? null);
  }

  function moveActiveBlock(direction: -1 | 1) {
    if (!activeBlock) return;
    if (model.blocks.some((block) => docxTextEditingBlockReason(block))) {
      setInteractionError(
        "Blocks were not reordered because this document contains range-anchored complex paragraphs.",
      );
      return;
    }
    const index = model.blocks.findIndex((block) => block.id === activeBlock.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= model.blocks.length) return;
    const nextBlocks = [...model.blocks];
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(nextIndex, 0, moved);
    onChange({ ...model, blocks: nextBlocks });
  }

  function copyBlockFormatting(index: number) {
    const block = model.blocks[index];
    if (isDocxTextBlock(block)) setFormatClipboard(pickDocxFormatting(block));
  }

  function pasteBlockFormatting(index: number) {
    if (formatClipboard && isDocxTextBlock(model.blocks[index])) {
      updateBlock(index, formatClipboard);
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
    const offset = textOffsetWithin(element);
    const split = splitDocxTextBlockRuns(
      block,
      offset,
      nextDocxBlockId(model.blocks, "p"),
    );
    if (!split) return;
    if ("reason" in split) {
      setInteractionError(`Paragraph was not split. ${split.reason}`);
      return;
    }
    setInteractionError(null);
    replaceBlocks(
      model.blocks.flatMap((item, blockIndex) =>
        blockIndex === index ? [split.before, split.after] : [item],
      ),
      split.after.id,
    );
  }

  function mergeWithPreviousBlock(index: number, element: HTMLElement) {
    if (index <= 0 || textOffsetWithin(element) !== 0) return false;
    const current = model.blocks[index];
    const previous = model.blocks[index - 1];
    if (!isDocxTextBlock(current) || !isDocxTextBlock(previous)) {
      return false;
    }
    const merged = mergeDocxTextBlockRuns(previous, current);
    if ("reason" in merged) {
      setInteractionError(`Paragraphs were not merged. ${merged.reason}`);
      return true;
    }
    setInteractionError(null);
    replaceBlocks(
      model.blocks
        .map((block, blockIndex) =>
          blockIndex === index - 1
            ? merged.block
            : block,
        )
        .filter((_, blockIndex) => blockIndex !== index),
      previous.id,
    );
    return true;
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) =>
      runDocxEditorCommand(commandId, activeBlock, model.blocks, {
        adjustActiveIndent,
        applyNormalStyle,
        copyActiveFormatting,
        insertCommentReference,
        insertNoteReference,
        insertPageBreak,
        openLinkEditor,
        pasteActiveFormatting,
        toggleBlockList,
        toggleInlineBooleanOrBlock,
        updateActive,
      }),
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

  function updateImageBlock(index: number, patch: Partial<DocxBlock>) {
    const block = model.blocks[index];
    if (!block || block.type !== "image") return;
    updateBlock(index, patch);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <DocxEditorToolbar
        activeBlock={activeBlock}
        page={page}
        pageDraftDirty={pageDraftDirty}
        pageScopeLabel={pageDraftTarget.label}
        linkInputOpen={linkInputOpen}
        linkDraft={linkDraft}
        canPasteFormatting={Boolean(formatClipboard)}
        hasDocumentParts={hasDocumentParts}
        textPartsOpen={textPartsOpen}
        outlineOpen={outlineOpen}
        stylesOpen={stylesOpen}
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
        onApplyPageDraft={applyPageDraft}
        onCancelPageDraft={cancelPageDraft}
        onToggleTextPartsOpen={() => setTextPartsOpen((current) => !current)}
        onToggleOutlineOpen={() => setOutlineOpen((current) => !current)}
        onToggleStylesOpen={() => setStylesOpen((current) => !current)}
        onMoveActiveBlock={moveActiveBlock}
        onDeleteActiveBlock={deleteActiveBlock}
        onInsertImageFile={insertImageFile}
        onAddBlock={addBlock}
        onInsertPageBreak={insertPageBreak}
        onInsertSectionBreak={insertSectionBreak}
      />
      {interactionError && (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-3 py-1.5 text-xs text-[var(--status-warning)]"
        >
          {interactionError}
        </div>
      )}
      {pendingImages.map((operation) => (
        <div
          key={operation.id}
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5 text-xs text-[var(--text-muted)]"
        >
          <span>Reading {operation.name} for insertion at its original paragraph…</span>
          <button
            type="button"
            onClick={() => cancelPendingImage(operation.id)}
            className="rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
        </div>
      ))}
      {stylesOpen && (
        <DocxStylePanel
          activeBlock={activeBlock}
          styles={model.styles ?? []}
          onCreateFromActive={createParagraphStyleFromActive}
          onDeleteStyle={deleteParagraphStyle}
          onStyleChange={updateParagraphStyle}
        />
      )}
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
          <DocxOutlinePanel
            activeBlockId={activeBlock?.id}
            items={outlineItems}
            onClose={() => setOutlineOpen(false)}
            onFocusBlock={focusBlockById}
          />
        )}
        <DocxDocumentCanvas
          activePage={pageDraft}
          activeBlockId={activeBlock?.id}
          composingBlockIdRef={composingBlockIdRef}
          model={model}
          onAddBlock={addBlock}
          onAddTableColumn={addTableColumn}
          onAddTableRow={addTableRow}
          onClearTableCell={clearTableCell}
          onDeleteTableColumn={deleteTableColumn}
          onDeleteTableRow={deleteTableRow}
          onDuplicateTableColumn={duplicateTableColumn}
          onDuplicateTableRow={duplicateTableRow}
          onHandleBlockShortcut={(event, index) =>
            handleDocxBlockShortcut(event, index, {
              copyBlockFormatting,
              insertCommentReference,
              insertNoteReference,
              normalFontSizeForBlock: (blockIndex) =>
                model.blocks[blockIndex]?.fontSize ?? "14",
              pasteBlockFormatting,
              toggleBlockList,
              toggleInlineBooleanOrBlock,
              updateBlock,
            })
          }
          onInsertPageBreak={insertPageBreak}
          onInsertTableColumn={insertTableColumn}
          onInsertTableRow={insertTableRow}
          onMergeTableCellDown={mergeTableCellDown}
          onMergeTableCellRight={mergeTableCellRight}
          onMergeWithPreviousBlock={mergeWithPreviousBlock}
          onMoveTableColumn={moveTableColumn}
          onMoveTableRow={moveTableRow}
          onOpenTextPartsForBlock={(blockId) => {
            setActiveBlockId(blockId);
            setTextPartsOpen(true);
          }}
          onPasteClipboardIntoBlock={pasteClipboardIntoBlock}
          onPasteTableCells={pasteTableCells}
          onSetActiveBlockId={setActiveBlockId}
          onSplitTableCell={splitTableCell}
          onSplitTextBlockAtCaret={splitTextBlockAtCaret}
          onUpdateBlock={updateBlock}
          onUpdateImageBlock={updateImageBlock}
          onUpdatePage={updatePage}
          onUpdateTableCell={updateTableCell}
          onUpdateTableColumnWidth={updateTableColumnWidth}
          onUpdateTableRowHeight={updateTableRowHeight}
          onUpdateTableStyle={updateTableStyle}
        />
      </div>
    </div>
  );
}

function nextParagraphStyleId(styles: DocxStyle[], name: string) {
  const existing = new Set(styles.map((style) => style.id));
  const base =
    name
      .replace(/[^A-Za-z0-9_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "CustomStyle";
  let candidate = base;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  return candidate;
}

function docxBlockTextSelection(block: DocxBlock) {
  const element = document.querySelector<HTMLElement>(
    `[data-docx-block="${CSS.escape(block.id)}"]`,
  );
  const range = element ? textSelectionOffsetsWithin(element) : null;
  return range;
}
