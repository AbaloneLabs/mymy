import { useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Image as ImageIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { columnName } from "./models";
import type {
  DocxBlock,
  DocxComment,
  DocxNote,
  DocxPageSettings,
  DocxTextPart,
} from "./models";
import {
  DOCX_PAGE_PRESETS,
  TWIPS_PER_INCH,
  clampImageDimension,
  clampTableCell,
  inchesToTwips,
  normalizeDocxTableRow,
  tableClipboardMatrix,
  tableColumnCount,
  twipsToCssPixels,
  twipsToInches,
} from "./docxEditorUtils";

export function DocxRuler({
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

export function DocxMarginInput({
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

export function DocxTextPartsPanel({
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

export function DocxImageBlock({
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

export function DocxTableBlock({
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
