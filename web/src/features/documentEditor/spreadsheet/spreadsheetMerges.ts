import { xlsxRangeFromRef } from "./spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";
import type { XlsxMergedRange } from "../shared/models";

export type XlsxMergeFragment = {
  anchor: CellPosition;
  columnIndexes: number[];
  colSpan: number;
  isFragmentAnchor: boolean;
  range: NormalizedCellRange;
  rowIndexes: number[];
  rowSpan: number;
};

export function parsedXlsxMergedRanges(ranges: XlsxMergedRange[] | undefined) {
  return (ranges ?? [])
    .map((range) => xlsxRangeFromRef(range.ref))
    .filter((range): range is NormalizedCellRange => range !== null);
}

export function xlsxMergedRangeForCell(
  ranges: NormalizedCellRange[],
  row: number,
  column: number,
) {
  return ranges.find(
    (range) =>
      row >= range.top &&
      row <= range.bottom &&
      column >= range.left &&
      column <= range.right,
  );
}

/**
 * Virtualized rows and columns can omit the real top-left merge anchor. A
 * fragment anchor represents the visible intersection in that viewport while
 * every edit and selection still targets the real workbook anchor. This avoids
 * blank merged regions when scrolling into the middle of a large merge.
 */
export function xlsxMergeFragmentForCell(
  range: NormalizedCellRange,
  renderedRowIndexes: number[],
  renderedColumnIndexes: number[],
  row: number,
  column: number,
): XlsxMergeFragment | null {
  const rowIndexes = renderedRowIndexes.filter(
    (index) => index >= range.top && index <= range.bottom,
  );
  const columnIndexes = renderedColumnIndexes.filter(
    (index) => index >= range.left && index <= range.right,
  );
  if (rowIndexes.length === 0 || columnIndexes.length === 0) return null;
  return {
    anchor: { row: range.top, column: range.left },
    columnIndexes,
    colSpan: columnIndexes.length,
    isFragmentAnchor: row === rowIndexes[0] && column === columnIndexes[0],
    range,
    rowIndexes,
    rowSpan: rowIndexes.length,
  };
}

export function xlsxMergeAwareSelectionTarget(
  ranges: NormalizedCellRange[],
  position: CellPosition,
  selectionAnchor: CellPosition | null,
  extend: boolean,
) {
  const range = xlsxMergedRangeForCell(ranges, position.row, position.column);
  if (!range) {
    return { active: position, anchor: position, end: position };
  }
  const active = { row: range.top, column: range.left };
  if (!extend || !selectionAnchor) {
    return {
      active,
      anchor: active,
      end: { row: range.bottom, column: range.right },
    };
  }
  return {
    active,
    anchor: selectionAnchor,
    end: {
      row: position.row >= selectionAnchor.row ? range.bottom : range.top,
      column: position.column >= selectionAnchor.column ? range.right : range.left,
    },
  };
}
