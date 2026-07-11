import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EditorCommandRequest } from "../shared/commands";
import { columnName, normalizeRow } from "../shared/models";
import type { DelimitedTableModel } from "../shared/models";
import { DelimitedTableGrid } from "../delimitedTable/delimitedTableGrid";
import { DelimitedTableMetadataBar } from "../delimitedTable/delimitedTableMetadataBar";
import { DelimitedTableProfilePanel } from "../delimitedTable/delimitedProfilePanel";
import { delimitedLooksLikeHeader } from "../delimitedTable/delimitedTableUtils";
import {
  changedDelimitedFormatKeys,
  delimitedEncodingIssue,
  delimitedFormatDraft as createDelimitedFormatDraft,
  delimitedFormatSample,
} from "../delimitedTable/delimitedFormatDraft";
import {
  ensureDelimitedDisplayRows,
  ensureDelimitedRows,
  DELIMITED_MATRIX_MIME,
  delimitedSortBlockReason,
  filteredDelimitedRows,
  rangeToClipboardText,
  serializeInternalDelimitedMatrix,
  sortedDelimitedRowIndexes,
  valuesFromDelimitedRange,
} from "../spreadsheet";
import {
  MIN_DELIMITED_VISIBLE_COLUMNS,
  MIN_DELIMITED_VISIBLE_ROWS,
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  clampCellRange,
  emptyViewport,
  normalizeCellRange,
  rangeToA1,
  scrollCellIntoView,
  virtualWindow,
  xlsxRangeFromRef,
} from "../spreadsheet";
import type { CellPosition, SpreadsheetViewport } from "../spreadsheet";
import { SpreadsheetStatusBar } from "../spreadsheet";
import {
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
  summarizeSelection,
} from "../spreadsheet";
import { SpreadsheetToolbar } from "../spreadsheet";

export function DelimitedTableEditor({
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  model: DelimitedTableModel;
  onChange: (model: DelimitedTableModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<CellPosition | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<CellPosition | null>(null);
  const [filterText, setFilterText] = useState("");
  const [headerRow, setHeaderRow] = useState(
    () => model.headerRow ?? delimitedLooksLikeHeader(model.rows),
  );
  const [columnTypes, setColumnTypes] = useState<string[]>(() => [
    ...(model.columnTypes ?? []),
  ]);
  const rowIdSequenceRef = useRef(model.rows.length);
  const [rowIds, setRowIds] = useState(() =>
    model.rows.map((_, index) => `delimited-row-${index + 1}`),
  );
  const [sortSnapshot, setSortSnapshot] = useState<string[] | null>(null);
  const [sortMessage, setSortMessage] = useState<string | null>(null);
  const baselineFormat = createDelimitedFormatDraft(model);
  const [formatDraft, setFormatDraft] = useState(() => baselineFormat);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<SpreadsheetViewport>(emptyViewport);
  const sourceRows = model.rows.length > 0 ? model.rows : [[]];
  const sourceColumnCount = Math.max(1, ...sourceRows.map((row) => row.length));
  const columnCount = Math.max(MIN_DELIMITED_VISIBLE_COLUMNS, sourceColumnCount);
  const displayRowLimit = Math.max(MIN_DELIMITED_VISIBLE_ROWS, sourceRows.length);
  const rows = ensureDelimitedDisplayRows(sourceRows, displayRowLimit);
  const visibleRows = filteredDelimitedRows(rows, columnCount, filterText);
  const rowWindow = virtualWindow(
    visibleRows.length,
    Math.max(0, viewport.scrollTop - SPREADSHEET_HEADER_HEIGHT),
    viewport.height,
    SPREADSHEET_ROW_HEIGHT,
    12,
  );
  const columnWindow = virtualWindow(
    columnCount,
    Math.max(0, viewport.scrollLeft - SPREADSHEET_ROW_HEADER_WIDTH),
    viewport.width,
    SPREADSHEET_COLUMN_WIDTH,
    4,
  );
  const selectionRange = normalizeCellRange(selectionAnchor, selectionEnd);
  const activeCellValue =
    activeCell && rows[activeCell.row]?.[activeCell.column]
      ? rows[activeCell.row][activeCell.column]
      : "";
  const selectedValues = selectionRange
    ? valuesFromDelimitedRange(rows, columnCount, selectionRange)
    : activeCellValue
      ? [[activeCellValue]]
      : [];
  const selectionSummary = summarizeSelection(selectedValues);
  const changedFormatKeys = changedDelimitedFormatKeys(
    baselineFormat,
    formatDraft,
  );
  const formatEncodingIssue = delimitedEncodingIssue(
    sourceRows,
    formatDraft.encoding,
    formatDraft.bom,
  );
  const formatModel = { ...model, ...formatDraft };

  function updateFormatModel(next: DelimitedTableModel) {
    setFormatDraft(createDelimitedFormatDraft(next));
  }

  function applyFormatDraft() {
    if (changedFormatKeys.length === 0 || formatEncodingIssue) return;
    onChange({ ...model, ...formatDraft });
  }

  function nextRowId() {
    rowIdSequenceRef.current += 1;
    return `delimited-row-${rowIdSequenceRef.current}`;
  }

  function rowIdsForLength(length: number) {
    const next = rowIds.slice(0, length);
    while (next.length < length) next.push(nextRowId());
    return next;
  }

  function commitDelimitedRows(nextRows: string[][], nextRowIds?: string[]) {
    setRowIds(nextRowIds ?? rowIdsForLength(nextRows.length));
    onChange({
      ...model,
      rows: nextRows,
    });
  }

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    const nextRows = sourceRows.map((row) => [...row]);
    while (nextRows.length <= rowIndex) nextRows.push([]);
    while (nextRows[rowIndex].length <= columnIndex) nextRows[rowIndex].push("");
    nextRows[rowIndex][columnIndex] = value;
    commitDelimitedRows(nextRows);
  }

  function updateCellsFromMatrix(
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    if (matrix.length === 0) return;
    const nextRows = sourceRows.map((row) => [...row]);
    matrix.forEach((pastedRow, rowOffset) => {
      const rowIndex = startRow + rowOffset;
      while (nextRows.length <= rowIndex) nextRows.push([]);
      const target = nextRows[rowIndex];
      while (target.length < startColumn + pastedRow.length) target.push("");
      pastedRow.forEach((value, columnOffset) => {
        target[startColumn + columnOffset] = value;
      });
    });
    commitDelimitedRows(nextRows);
  }

  function selectCell(position: CellPosition, extend = false) {
    setActiveCell(position);
    if (extend && selectionAnchor) {
      setSelectionEnd(position);
    } else {
      setSelectionAnchor(position);
      setSelectionEnd(position);
    }
  }

  function selectAllCells() {
    setActiveCell({ row: 0, column: 0 });
    setSelectionAnchor({ row: 0, column: 0 });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, 0, 0);
  }

  function selectColumn(column: number) {
    setActiveCell({ row: 0, column });
    setSelectionAnchor({ row: 0, column });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column,
    });
    scrollCellIntoView(gridRef.current, 0, column);
  }

  function selectRow(row: number) {
    setActiveCell({ row, column: 0 });
    setSelectionAnchor({ row, column: 0 });
    setSelectionEnd({
      row,
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, row, 0);
  }

  async function copySelection() {
    if (!selectionRange) return;
    const plainText = rangeToClipboardText(selectedValues);
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plainText], { type: "text/plain" }),
            [DELIMITED_MATRIX_MIME]: new Blob(
              [serializeInternalDelimitedMatrix(selectedValues)],
              { type: DELIMITED_MATRIX_MIME },
            ),
          }),
        ]);
        return;
      } catch {
        // Browsers may reject custom clipboard MIME types; plain text remains
        // a fully quoted interoperable fallback parsed by the same state machine.
      }
    }
    await navigator.clipboard?.writeText(plainText);
  }

  function fillDown() {
    if (!selectionRange || selectionRange.bottom <= selectionRange.top) return;
    const sourceRow = normalizeRow(rows[selectionRange.top] ?? [], columnCount);
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) =>
        Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) =>
            rowOffset === 0
              ? sourceRow[selectionRange.left + columnOffset] ?? ""
              : sourceRow[selectionRange.left + columnOffset] ?? "",
        ),
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function fillRight() {
    if (!selectionRange || selectionRange.right <= selectionRange.left) return;
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) => {
        const row = normalizeRow(rows[selectionRange.top + rowOffset] ?? [], columnCount);
        const source = row[selectionRange.left] ?? "";
        return Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) =>
            columnOffset === 0 ? row[selectionRange.left] ?? "" : source,
        );
      },
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function sortRowsByActiveColumn(direction: "asc" | "desc") {
    if (!activeCell) return;
    const reconciledIds = rowIdsForLength(sourceRows.length);
    let scope = "all data rows";
    let targetIndexes: number[];
    if (selectionRange && selectionRange.bottom > selectionRange.top) {
      if (
        activeCell.column < selectionRange.left ||
        activeCell.column > selectionRange.right
      ) {
        setSortMessage("Sort blocked: the active sort column is outside the selection");
        return;
      }
      const top = Math.min(selectionRange.top, sourceRows.length);
      const bottom = Math.min(selectionRange.bottom, sourceRows.length - 1);
      targetIndexes =
        top <= bottom
          ? Array.from({ length: bottom - top + 1 }, (_, offset) => top + offset)
          : [];
      scope = `selected rows ${selectionRange.top + 1}-${Math.min(
        selectionRange.bottom + 1,
        sourceRows.length,
      )}`;
    } else if (filterText.trim()) {
      targetIndexes = visibleRows
        .map((item) => item.rowIndex)
        .filter((rowIndex) => rowIndex < sourceRows.length);
      scope = "currently filtered rows";
    } else {
      targetIndexes = sourceRows.map((_, rowIndex) => rowIndex);
    }
    const headerExcluded = headerRow && targetIndexes.includes(0);
    if (headerExcluded) targetIndexes = targetIndexes.filter((rowIndex) => rowIndex !== 0);
    if (targetIndexes.length < 2) {
      setSortMessage("Sort made no change: fewer than two data rows are in scope");
      return;
    }
    const blockReason = delimitedSortBlockReason(
      sourceRows,
      targetIndexes,
      activeCell.column,
    );
    if (blockReason) {
      setSortMessage(blockReason);
      return;
    }
    const sortedSourceIndexes = sortedDelimitedRowIndexes(
      sourceRows,
      targetIndexes,
      activeCell.column,
      direction,
    );
    const targetPositions = [...targetIndexes].sort((left, right) => left - right);
    const nextRows = sourceRows.map((row) => row);
    const nextIds = [...reconciledIds];
    targetPositions.forEach((targetIndex, index) => {
      const sourceIndex = sortedSourceIndexes[index];
      nextRows[targetIndex] = sourceRows[sourceIndex];
      nextIds[targetIndex] = reconciledIds[sourceIndex];
    });
    setSortSnapshot((current) => current ?? reconciledIds);
    setSortMessage(
      `Sorted ${scope} by ${columnName(activeCell.column)} ${direction}; ${
        headerExcluded ? "header excluded" : "no header in scope"
      }`,
    );
    commitDelimitedRows(nextRows, nextIds);
  }

  function restorePreSortOrder() {
    if (!sortSnapshot) return;
    const reconciledIds = rowIdsForLength(sourceRows.length);
    const rowById = new Map(
      reconciledIds.map((rowId, index) => [rowId, sourceRows[index]] as const),
    );
    const restoredIds = sortSnapshot.filter((rowId) => rowById.has(rowId));
    reconciledIds.forEach((rowId) => {
      if (!restoredIds.includes(rowId)) restoredIds.push(rowId);
    });
    commitDelimitedRows(
      restoredIds.map((rowId) => rowById.get(rowId) ?? []),
      restoredIds,
    );
    setSortSnapshot(null);
    setSortMessage("Restored the pre-sort row order while retaining later cell edits");
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
      if (commandId === "fillDown") {
        fillDown();
      } else if (commandId === "fillRight") {
        fillRight();
      } else if (commandId === "sortAscending") {
        sortRowsByActiveColumn("asc");
      } else if (commandId === "sortDescending") {
        sortRowsByActiveColumn("desc");
      } else if (commandId === "filter") {
        setFilterText((current) => (current ? "" : activeCellValue));
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

  function addRow() {
    const insertAt = activeCell ? activeCell.row + 1 : sourceRows.length;
    const requiredColumns = Math.max(sourceColumnCount, (activeCell?.column ?? 0) + 1);
    const nextRows = sourceRows.map((row) => [...row]);
    nextRows.splice(insertAt, 0, Array(requiredColumns).fill(""));
    const nextIds = rowIdsForLength(sourceRows.length);
    nextIds.splice(insertAt, 0, nextRowId());
    commitDelimitedRows(nextRows, nextIds);
    setActiveCell({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionAnchor({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionEnd({ row: insertAt, column: activeCell?.column ?? 0 });
  }

  function addColumn() {
    const insertAt = activeCell ? activeCell.column + 1 : sourceColumnCount;
    const requiredColumns = Math.max(sourceColumnCount, insertAt);
    commitDelimitedRows(
      ensureDelimitedRows(sourceRows, Math.max(1, sourceRows.length), requiredColumns).map((row) => {
        const next = normalizeRow(row, requiredColumns);
        next.splice(insertAt, 0, "");
        return next;
      }),
    );
    setActiveCell({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionAnchor({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionEnd({ row: activeCell?.row ?? 0, column: insertAt });
  }

  function deleteActiveRow() {
    if (!activeCell || activeCell.row >= sourceRows.length || sourceRows.length <= 1) return;
    commitDelimitedRows(
      sourceRows.filter((_, index) => index !== activeCell.row),
      rowIdsForLength(sourceRows.length).filter(
        (_, index) => index !== activeCell.row,
      ),
    );
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function deleteActiveColumn() {
    if (!activeCell || activeCell.column >= sourceColumnCount || sourceColumnCount <= 1) return;
    commitDelimitedRows(
      sourceRows.map((row) =>
        row.filter((_, index) => index !== activeCell.column),
      ),
    );
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.row, activeCell.column, "");
  }

  function selectReference(reference: string) {
    const range = xlsxRangeFromRef(reference.trim());
    if (!range) return;
    const clamped = clampCellRange(range, displayRowLimit, columnCount);
    setActiveCell({ row: clamped.top, column: clamped.left });
    setSelectionAnchor({ row: clamped.top, column: clamped.left });
    setSelectionEnd({ row: clamped.bottom, column: clamped.right });
    scrollCellIntoView(gridRef.current, clamped.top, clamped.left);
  }

  function focusCell(row: number, column: number) {
    selectCell({ row, column });
    scrollCellIntoView(gridRef.current, row, column);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-delimited-cell="${row}:${column}"]`,
      );
      input?.focus();
      input?.select();
    });
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    row: number,
    column: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (primary && event.key.toLowerCase() === "d") {
      event.preventDefault();
      fillDown();
      return;
    }
    if (primary && event.key.toLowerCase() === "r") {
      event.preventDefault();
      fillRight();
      return;
    }
    if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row: Math.min(row + 1, displayRowLimit - 1), column }, true);
      return;
    }
    if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row: Math.max(row - 1, 0), column }, true);
      return;
    }
    if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.min(column + 1, columnCount - 1) }, true);
      return;
    }
    if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.max(column - 1, 0) }, true);
      return;
    }
    if (primary && event.key === ";") {
      event.preventDefault();
      updateCell(
        row,
        column,
        event.shiftKey ? spreadsheetTimeStamp() : spreadsheetDateStamp(),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusCell(
        event.shiftKey ? Math.max(row - 1, 0) : Math.min(row + 1, displayRowLimit - 1),
        column,
      );
    } else if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const nextColumn = column + direction;
      if (nextColumn >= 0 && nextColumn < columnCount) {
        focusCell(row, nextColumn);
      } else if (!event.shiftKey && row < displayRowLimit - 1) {
        focusCell(row + 1, 0);
      } else if (event.shiftKey && row > 0) {
        focusCell(row - 1, columnCount - 1);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SpreadsheetToolbar
        activeCellLabel={
          selectionRange
            ? rangeToA1(selectionRange)
            : activeCell
              ? `${columnName(activeCell.column)}${activeCell.row + 1}`
              : "-"
        }
        activeCellValue={activeCellValue}
        activeCellDisabled={!activeCell}
        onActiveCellLabelChange={selectReference}
        onActiveCellChange={(value) => {
          if (!activeCell) return;
          updateCell(activeCell.row, activeCell.column, value);
        }}
        onAddRow={addRow}
        onAddColumn={addColumn}
        onDeleteRow={deleteActiveRow}
        onDeleteColumn={deleteActiveColumn}
        onClearCell={clearActiveCell}
        onCopySelection={() => void copySelection()}
        onFillDown={fillDown}
        onFillRight={fillRight}
        onSortAsc={() => sortRowsByActiveColumn("asc")}
        onSortDesc={() => sortRowsByActiveColumn("desc")}
        filterText={filterText}
        onFilterTextChange={setFilterText}
        canDeleteRow={Boolean(activeCell && activeCell.row < sourceRows.length && sourceRows.length > 1)}
        canDeleteColumn={Boolean(activeCell && activeCell.column < sourceColumnCount && sourceColumnCount > 1)}
        canClearCell={Boolean(activeCell)}
        canCopy={Boolean(selectionRange)}
        canFillDown={Boolean(selectionRange && selectionRange.bottom > selectionRange.top)}
        canFillRight={Boolean(selectionRange && selectionRange.right > selectionRange.left)}
        canSort={Boolean(activeCell)}
      />
      {changedFormatKeys.length > 0 && (
        <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] md:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)_auto]">
          <div>
            <div>
              File format draft: {changedFormatKeys.join(", ")}
            </div>
            {formatEncodingIssue && (
              <div className="mt-1 text-[var(--status-error)]">
                {formatEncodingIssue}
              </div>
            )}
          </div>
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--bg)] p-1.5 font-mono text-[10px]">
            {delimitedFormatSample(sourceRows, formatDraft)}
          </pre>
          <div className="flex items-start gap-1">
            <button
              type="button"
              disabled={Boolean(formatEncodingIssue)}
              onClick={applyFormatDraft}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply format
            </button>
            <button
              type="button"
              onClick={() => setFormatDraft(baselineFormat)}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 hover:bg-[var(--surface-hover)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <DelimitedTableMetadataBar
        model={formatModel}
        onChange={updateFormatModel}
      />
      <DelimitedTableProfilePanel
        rows={sourceRows}
        headerRow={headerRow}
        columnTypes={columnTypes}
        model={formatModel}
        onModelChange={updateFormatModel}
        onHeaderRowChange={setHeaderRow}
        onColumnTypesChange={setColumnTypes}
      />
      {sortMessage && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
          <span>{sortMessage}</span>
          {sortSnapshot && (
            <button
              type="button"
              onClick={restorePreSortOrder}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 hover:bg-[var(--surface-hover)]"
            >
              Restore pre-sort order
            </button>
          )}
          <button
            type="button"
            onClick={() => setSortMessage(null)}
            className="ml-auto rounded px-1 hover:bg-[var(--surface-hover)]"
          >
            Dismiss
          </button>
        </div>
      )}
      <DelimitedTableGrid
        gridRef={gridRef}
        activeCell={activeCell}
        selectionRange={selectionRange}
        sourceRows={sourceRows}
        headerRow={headerRow}
        columnCount={columnCount}
        displayRowLimit={displayRowLimit}
        rowWindow={rowWindow}
        columnWindow={columnWindow}
        visibleRows={visibleRows}
        onViewportChange={setViewport}
        onSelectAllCells={selectAllCells}
        onSelectColumn={selectColumn}
        onSelectRow={selectRow}
        onSelectCell={selectCell}
        onSetActiveCell={setActiveCell}
        onUpdateCell={updateCell}
        onUpdateCellsFromMatrix={updateCellsFromMatrix}
        onCellKeyDown={handleCellKeyDown}
      />
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}
