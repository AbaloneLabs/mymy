import type { NormalizedCellRange } from "./spreadsheetGeometry";

export function addSpreadsheetSelectionRange(
  ranges: NormalizedCellRange[],
  range: NormalizedCellRange,
) {
  if (ranges.some((item) => sameSpreadsheetRange(item, range))) return ranges;
  return [...ranges, range];
}

function sameSpreadsheetRange(
  left: NormalizedCellRange,
  right: NormalizedCellRange,
) {
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.bottom === right.bottom &&
    left.right === right.right
  );
}
