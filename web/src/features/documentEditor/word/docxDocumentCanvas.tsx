import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  docxPageStyle,
  sectionBreakLabel,
} from "./docxEditorUtils";
import {
  docxRenderableRuns,
  docxRunStyle,
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

type AddDocxBlockType = Exclude<
  DocxBlock["type"],
  "image" | "pageBreak" | "sectionBreak"
>;

type DocxDocumentCanvasProps = {
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
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface)] p-6">
      <DocxRuler page={model.page} onChange={onUpdatePage} />
      <div
        className="mx-auto min-h-[980px] max-w-full border border-[var(--border)] bg-white text-neutral-950 shadow-sm"
        style={docxPageStyle(model.page)}
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
          const paragraphStyle = docxStyleForBlock(model.styles, block);
          return (
            <div key={block.id} className="relative">
              <div
                contentEditable
                suppressContentEditableWarning
                onFocus={() => onSetActiveBlockId(block.id)}
                onCompositionStart={() => {
                  composingBlockIdRef.current = block.id;
                }}
                onCompositionEnd={(event) => {
                  composingBlockIdRef.current = null;
                  onUpdateBlock(
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
                  onClick={() => onOpenTextPartsForBlock(block.id)}
                  className="absolute right-0 top-0 -translate-y-1/3 rounded-sm px-1 align-super text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
                  title="Footnote"
                >
                  {block.footnoteId}
                </button>
              )}
              {block.endnoteId && (
                <button
                  type="button"
                  onClick={() => onOpenTextPartsForBlock(block.id)}
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
  );
}
