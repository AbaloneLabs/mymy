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
  toggleDocxInlineBooleanRange,
} from "../word/docxTextRuns";
import { builtInFontFamilies } from "../shared/fonts";
import type {
  DocxBlock,
  DocxModel,
  DocxPageSettings,
} from "../shared/models";
import { DocxTextPartsPanel } from "../word/docxTextPartsPanel";
import { DocxEditorToolbar } from "../word/docxEditorToolbar";
import { createDocxTableActions } from "../word/docxTableActions";
import { DocxOutlinePanel } from "../word/docxOutline";
import { buildDocxOutlineItems } from "../word/docxOutlineModel";
import { DocxDocumentCanvas } from "../word/docxDocumentCanvas";
import { createDocxPartsActions } from "../word/docxPartsActions";
import { runDocxEditorCommand } from "../word/docxEditorCommands";
import { handleDocxBlockShortcut } from "../word/docxBlockShortcuts";

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
  const outlineItems = buildDocxOutlineItems(model.blocks);

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
          <DocxOutlinePanel
            activeBlockId={activeBlock?.id}
            items={outlineItems}
            onClose={() => setOutlineOpen(false)}
            onFocusBlock={focusBlockById}
          />
        )}
        <DocxDocumentCanvas
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
