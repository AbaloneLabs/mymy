import { describe, expect, it } from "vitest";
import {
  normalizeCellRange,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  virtualWindow,
} from "./spreadsheetGeometry";
import { xlsxDisplayRowCount } from "./spreadsheetXlsxGridModel";
import type { XlsxSheet } from "../shared/models";

describe("spreadsheet geometry", () => {
  it("virtualizes large sheets without capping the total row count", () => {
    const window = virtualWindow(100_000, 32 * 50_000, 320, 32, 4);

    expect(window.start).toBe(49_996);
    expect(window.end).toBe(50_014);
  });

  it("keeps a valid one-item window near the end of the sheet", () => {
    expect(virtualWindow(10, 10_000, 0, 32, 2)).toEqual({ start: 9, end: 10 });
  });

  it("uses XLSX content and metadata row counts above the minimum display floor", () => {
    const tallSheet: XlsxSheet = {
      id: "sheet-1",
      name: "Sheet1",
      rows: Array.from({ length: 12_345 }, (_, index) => ({
        index: String(index + 1),
        cells: [],
      })),
    };
    const metadataOnlySheet: XlsxSheet = {
      id: "sheet-2",
      name: "Sheet2",
      rows: [],
      mergedRanges: [{ ref: "A20000:A20000" }],
    };

    expect(xlsxDisplayRowCount(tallSheet)).toBe(12_345);
    expect(xlsxDisplayRowCount(metadataOnlySheet)).toBe(20_000);
  });

  it("normalizes dragged ranges and detects full row, column, and sheet coverage", () => {
    const range = normalizeCellRange({ row: 10, column: 5 }, { row: 0, column: 0 });

    expect(range).toEqual({ top: 0, right: 5, bottom: 10, left: 0 });
    expect(rangeCoversSheet(range, 11, 6)).toBe(true);
    expect(rangeCoversColumn(range, 3, 11)).toBe(true);
    expect(rangeCoversRow(range, 4, 6)).toBe(true);
    expect(rangeCoversRow(range, 4, 7)).toBe(false);
  });
});
