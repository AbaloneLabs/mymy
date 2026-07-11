import type {
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  docxPageStyle,
  sectionBreakLabel,
  setTextSelectionOffsetsWithin,
  textSelectionOffsetsWithin,
} from "./docxEditorUtils";
import {
  docxRenderableRuns,
  docxTextEditingBlockReason,
  docxRunStyle,
  docxRunTextInputPatch,
  docxStyleForBlock,
  docxTextBlockStyle,
  docxTextEditPatch,
} from "./docxTextRuns";
import type {
  DocxBlock,
  DocxModel,
  DocxPageSettings,
} from "../shared/models";
import { DocxImageBlock } from "./docxImageBlock";
import { DocxRuler } from "./docxPageLayoutControls";
import { DocxTableBlock } from "./docxTableBlock";
import {
  docxAnchoredTextSegments,
  docxCommentRanges,
  docxHyperlinkRanges,
  docxNoteReferences,
} from "./docxTextAnchors";

type AddDocxBlockType = Exclude<
  DocxBlock["type"],
  "image" | "pageBreak" | "sectionBreak"
>;

type DocxDocumentCanvasProps = {
  activePage?: DocxPageSettings;
  activeBlockId?: string | null;
  composingBlockIdRef: RefObject<string | null>;
  model: DocxModel;
  onAddBlock: (type?: AddDocxBlockType) => void;
  onAddTableColumn: (blockIndex: number) => void;
  onAddTableRow: (blockIndex: number) => void;
  onClearTableCell: (blockIndex: number, rowIndex: number, columnIndex: number) => void;
  onDeleteTableColumn: (blockIndex: number, columnIndex: number) => void;
  onDeleteTableRow: (blockIndex: number, rowIndex: number) => void;
  onDuplicateTableColumn: (blockIndex: number, columnIndex: number) => void;
  onDuplicateTableRow: (blockIndex: number, rowIndex: number) => void;
  onHandleBlockShortcut: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    blockIndex: number,
  ) => void;
  onInsertPageBreak: () => void;
  onInsertTableColumn: (
    blockIndex: number,
    columnIndex: number,
    position: "left" | "right",
  ) => void;
  onInsertTableRow: (
    blockIndex: number,
    rowIndex: number,
    position: "above" | "below",
  ) => void;
  onMergeTableCellDown: (
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) => void;
  onMergeTableCellRight: (
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) => void;
  onMergeWithPreviousBlock: (blockIndex: number, element: HTMLElement) => boolean;
  onMoveTableColumn: (
    blockIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ) => void;
  onMoveTableRow: (
    blockIndex: number,
    rowIndex: number,
    direction: -1 | 1,
  ) => void;
  onOpenTextPartsForBlock: (blockId: string) => void;
  onPasteClipboardIntoBlock: (
    blockIndex: number,
    element: HTMLElement,
    clipboardData: Pick<DataTransfer, "getData">,
  ) => boolean;
  onPasteTableCells: (
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
    matrix: string[][],
  ) => void;
  onSetActiveBlockId: (blockId: string) => void;
  onSplitTableCell: (
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) => void;
  onSplitTextBlockAtCaret: (blockIndex: number, element: HTMLElement) => void;
  onUpdateBlock: (blockIndex: number, patch: Partial<DocxBlock>) => void;
  onUpdateImageBlock: (blockIndex: number, patch: Partial<DocxBlock>) => void;
  onUpdatePage: (patch: Partial<DocxPageSettings>) => void;
  onUpdateTableCell: (
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => void;
  onUpdateTableColumnWidth: (
    blockIndex: number,
    columnIndex: number,
    width: number,
  ) => void;
  onUpdateTableRowHeight: (
    blockIndex: number,
    rowIndex: number,
    height: number,
  ) => void;
  onUpdateTableStyle: (blockIndex: number, patch: Partial<DocxBlock>) => void;
};

export function DocxDocumentCanvas({
  activePage,
  activeBlockId,
  composingBlockIdRef,
  model,
  onAddBlock,
  onAddTableColumn,
  onAddTableRow,
  onClearTableCell,
  onDeleteTableColumn,
  onDeleteTableRow,
  onDuplicateTableColumn,
  onDuplicateTableRow,
  onHandleBlockShortcut,
  onInsertPageBreak,
  onInsertTableColumn,
  onInsertTableRow,
  onMergeTableCellDown,
  onMergeTableCellRight,
  onMergeWithPreviousBlock,
  onMoveTableColumn,
  onMoveTableRow,
  onOpenTextPartsForBlock,
  onPasteClipboardIntoBlock,
  onPasteTableCells,
  onSetActiveBlockId,
  onSplitTableCell,
  onSplitTextBlockAtCaret,
  onUpdateBlock,
  onUpdateImageBlock,
  onUpdatePage,
  onUpdateTableCell,
  onUpdateTableColumnWidth,
  onUpdateTableRowHeight,
  onUpdateTableStyle,
}: DocxDocumentCanvasProps) {
  const { t } = useTranslation();
  const skipNextCompositionInputRef = useRef<string | null>(null);

  function handleTextBlockBeforeInput(
    event: ReactFormEvent<HTMLDivElement>,
    block: DocxBlock,
    blockIndex: number,
  ) {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.isComposing || composingBlockIdRef.current === block.id) return;
    const selection = textSelectionOffsetsWithin(event.currentTarget);
    if (!selection) return;
    const result = docxRunPatchForInput(block, selection, inputEvent);
    if (!result) return;
    event.preventDefault();
    onUpdateBlock(blockIndex, result.patch);
    requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-docx-block="${CSS.escape(block.id)}"]`,
      );
      if (!element) return;
      element.focus();
      setTextSelectionOffsetsWithin(element, result.nextOffset);
    });
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-6">
      <DocxRuler page={activePage ?? model.page} onChange={onUpdatePage} />
      <div
        className="mx-auto min-h-[980px] max-w-full border border-[var(--border)] bg-white text-neutral-950 shadow-sm"
        style={docxPageStyle(activePage ?? model.page)}
      >
        {model.blocks.length === 0 && (
          <button
            type="button"
            onClick={() => onAddBlock("paragraph")}
            className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500"
          >
            {t("documentEditor.addParagraph")}
          </button>
        )}
        {model.blocks.map((block, index) => {
          const isActive = block.id === activeBlockId;
          if (block.type === "image") {
            return (
              <DocxImageBlock
                key={block.id}
                block={block}
                active={isActive}
                onFocus={() => onSetActiveBlockId(block.id)}
                onChange={(patch) => onUpdateImageBlock(index, patch)}
              />
            );
          }
          if (block.type === "pageBreak") {
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => onSetActiveBlockId(block.id)}
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
                onClick={() => onSetActiveBlockId(block.id)}
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
                onFocus={() => onSetActiveBlockId(block.id)}
                onCellChange={(rowIndex, columnIndex, value) =>
                  onUpdateTableCell(index, rowIndex, columnIndex, value)
                }
                onAddRow={() => onAddTableRow(index)}
                onAddColumn={() => onAddTableColumn(index)}
                onInsertRow={(rowIndex, position) =>
                  onInsertTableRow(index, rowIndex, position)
                }
                onInsertColumn={(columnIndex, position) =>
                  onInsertTableColumn(index, columnIndex, position)
                }
                onDuplicateRow={(rowIndex) => onDuplicateTableRow(index, rowIndex)}
                onDuplicateColumn={(columnIndex) =>
                  onDuplicateTableColumn(index, columnIndex)
                }
                onMoveRow={(rowIndex, direction) =>
                  onMoveTableRow(index, rowIndex, direction)
                }
                onMoveColumn={(columnIndex, direction) =>
                  onMoveTableColumn(index, columnIndex, direction)
                }
                onColumnWidthChange={(columnIndex, width) =>
                  onUpdateTableColumnWidth(index, columnIndex, width)
                }
                onRowHeightChange={(rowIndex, height) =>
                  onUpdateTableRowHeight(index, rowIndex, height)
                }
                onStyleChange={(patch) => onUpdateTableStyle(index, patch)}
                onDeleteRow={(rowIndex) => onDeleteTableRow(index, rowIndex)}
                onDeleteColumn={(columnIndex) =>
                  onDeleteTableColumn(index, columnIndex)
                }
                onClearCell={(rowIndex, columnIndex) =>
                  onClearTableCell(index, rowIndex, columnIndex)
                }
                onMergeCellRight={(rowIndex, columnIndex) =>
                  onMergeTableCellRight(index, rowIndex, columnIndex)
                }
                onMergeCellDown={(rowIndex, columnIndex) =>
                  onMergeTableCellDown(index, rowIndex, columnIndex)
                }
                onSplitCell={(rowIndex, columnIndex) =>
                  onSplitTableCell(index, rowIndex, columnIndex)
                }
                onPasteCells={(rowIndex, columnIndex, matrix) =>
                  onPasteTableCells(index, rowIndex, columnIndex, matrix)
                }
              />
            );
          }
          const runs = docxRenderableRuns(block);
          const hasTextAnchors =
            docxCommentRanges(block).length > 0 ||
            docxHyperlinkRanges(block).length > 0;
          const anchoredSegments = hasTextAnchors
            ? docxAnchoredTextSegments(block, runs ?? [{ text: block.text }])
            : null;
          const noteReferences = docxNoteReferences(block);
          const editingBlockReason = docxTextEditingBlockReason(block);
          const paragraphStyle = docxStyleForBlock(model.styles, block);
          return (
            <div key={block.id} className="relative">
              <div
                contentEditable={!editingBlockReason}
                aria-readonly={Boolean(editingBlockReason)}
                title={editingBlockReason ?? undefined}
                suppressContentEditableWarning
                onFocus={() => onSetActiveBlockId(block.id)}
                onCompositionStart={() => {
                  composingBlockIdRef.current = block.id;
                }}
                onCompositionEnd={(event) => {
                  composingBlockIdRef.current = null;
                  skipNextCompositionInputRef.current = block.id;
                  onUpdateBlock(
                    index,
                    docxTextEditPatch(
                      block,
                      event.currentTarget.textContent ?? "",
                    ),
                  );
                  window.setTimeout(() => {
                    if (skipNextCompositionInputRef.current === block.id) {
                      skipNextCompositionInputRef.current = null;
                    }
                  }, 0);
                }}
                onKeyDown={(event) => {
                  if (
                    event.nativeEvent.isComposing ||
                    composingBlockIdRef.current === block.id
                  ) {
                    return;
                  }
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    onInsertPageBreak();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSplitTextBlockAtCaret(index, event.currentTarget);
                    return;
                  }
                  if (
                    event.key === "Backspace" &&
                    onMergeWithPreviousBlock(index, event.currentTarget)
                  ) {
                    event.preventDefault();
                    return;
                  }
                  onHandleBlockShortcut(event, index);
                }}
                onBeforeInput={(event) =>
                  handleTextBlockBeforeInput(event, block, index)
                }
                onPaste={(event) => {
                  if (
                    onPasteClipboardIntoBlock(
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
                  if (skipNextCompositionInputRef.current === block.id) {
                    skipNextCompositionInputRef.current = null;
                    return;
                  }
                  onUpdateBlock(
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
                  editingBlockReason && "cursor-not-allowed bg-amber-50/60",
                  block.type === "heading" ? "mb-3 mt-4 font-semibold" : "mb-2 leading-7",
                  block.pageBreakBefore &&
                    "mt-8 border-t border-dashed border-neutral-300 pt-4",
                )}
                style={docxTextBlockStyle(block, paragraphStyle)}
              >
                {anchoredSegments
                  ? anchoredSegments.map((segment, segmentIndex) => (
                      <span
                        key={`${block.id}-anchor-${segmentIndex}`}
                        title={
                          segment.hyperlink?.target ??
                          (segment.commentIds.length > 0
                            ? `Comment ${segment.commentIds.map((id) => `#${id}`).join(", ")}`
                            : undefined)
                        }
                        data-docx-comment-ids={segment.commentIds.join(",") || undefined}
                        data-docx-hyperlink-id={segment.hyperlink?.id}
                        style={{
                          ...docxRunStyle(segment.run),
                          backgroundColor:
                            segment.commentIds.length > 0 ? "#fef3c7" : undefined,
                          color: segment.hyperlink ? "#1d4ed8" : undefined,
                          textDecoration: segment.hyperlink ? "underline" : undefined,
                        }}
                      >
                        {segment.text}
                      </span>
                    ))
                  : runs
                  ? runs.map((run, runIndex) => (
                      <span key={`${block.id}-run-${runIndex}`} style={docxRunStyle(run)}>
                        {run.text}
                      </span>
                    ))
                  : block.text}
              </div>
              {editingBlockReason && isActive && (
                <div className="mb-2 px-1 text-[10px] text-amber-700">
                  Limited paragraph: {editingBlockReason}. Metadata remains editable in
                  the document-parts panel.
                </div>
              )}
              {noteReferences.length > 0 && (
                <div className="absolute right-0 top-0 flex -translate-y-1/3 gap-0.5">
                  {noteReferences.map((reference, referenceIndex) => (
                    <button
                      key={`${reference.kind}-${reference.id}-${referenceIndex}`}
                      type="button"
                      onClick={() => onOpenTextPartsForBlock(block.id)}
                      className={cn(
                        "rounded-sm px-1 align-super text-[10px] font-semibold hover:bg-blue-50",
                        reference.kind === "footnote"
                          ? "text-blue-700"
                          : "text-emerald-700",
                      )}
                      title={`${reference.kind} at character ${reference.offset}`}
                    >
                      {reference.id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function docxRunPatchForInput(
  block: DocxBlock,
  selection: { start: number; end: number },
  event: InputEvent,
) {
  const inputType = event.inputType;
  const selectedStart = selection.start;
  const selectedEnd = selection.end;
  if (inputType === "insertText" && event.data) {
    const nextBlock = docxRunTextInputPatch(
      block,
      selectedStart,
      selectedEnd,
      event.data,
    );
    return nextBlock
      ? { patch: nextBlock, nextOffset: selectedStart + event.data.length }
      : null;
  }
  if (inputType === "insertLineBreak") {
    const nextBlock = docxRunTextInputPatch(block, selectedStart, selectedEnd, "\n");
    return nextBlock ? { patch: nextBlock, nextOffset: selectedStart + 1 } : null;
  }
  if (inputType === "deleteContentBackward") {
    const start =
      selectedStart === selectedEnd ? Math.max(0, selectedStart - 1) : selectedStart;
    if (start === selectedEnd) return null;
    const nextBlock = docxRunTextInputPatch(block, start, selectedEnd, "");
    return nextBlock ? { patch: nextBlock, nextOffset: start } : null;
  }
  if (inputType === "deleteContentForward") {
    const end =
      selectedStart === selectedEnd
        ? Math.min(block.text.length, selectedEnd + 1)
        : selectedEnd;
    if (selectedStart === end) return null;
    const nextBlock = docxRunTextInputPatch(block, selectedStart, end, "");
    return nextBlock ? { patch: nextBlock, nextOffset: selectedStart } : null;
  }
  return null;
}
