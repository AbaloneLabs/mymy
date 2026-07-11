import { describe, expect, test } from "vitest";

import {
  sortXlsxRange,
  xlsxSortBlockReason,
} from "./spreadsheetXlsxGridModel";
import type { XlsxSheet } from "../shared/models";

const range = { top: 1, right: 1, bottom: 3, left: 0 };
const sheet: XlsxSheet = {
  id: "sheet1",
  name: "Sheet1",
  rows: [
    { index: "1", cells: cells(1, "Header", "Label", "Outside header") },
    { index: "2", cells: cells(2, "3", "third", "outside one") },
    { index: "3", cells: cells(3, "1", "first", "outside two") },
    { index: "4", cells: cells(4, "2", "second", "outside three") },
  ],
};

describe("spreadsheet selected-range sort", () => {
  test("sorts raw selected cells while leaving headers and outside cells in place", () => {
    expect(xlsxSortBlockReason(sheet, range, 0)).toBeNull();

    const sorted = sortXlsxRange(sheet.rows, range, 0, "asc");

    expect(sorted[0].cells.map((cell) => cell.value)).toEqual([
      "Header",
      "Label",
      "Outside header",
    ]);
    expect(sorted.slice(1).map((row) => row.cells[0].value)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(sorted.slice(1).map((row) => row.cells[1].value)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(sorted.slice(1).map((row) => row.cells[2].value)).toEqual([
      "outside one",
      "outside two",
      "outside three",
    ]);
    expect(sorted[1].cells[0].ref).toBe("A2");
  });

  test("classifies combinations whose ownership cannot be preserved", () => {
    expect(
      xlsxSortBlockReason(
        {
          ...sheet,
          rows: sheet.rows.map((row, index) =>
            index === 1
              ? {
                  ...row,
                  cells: [{ ref: "A2", value: "3", formula: "C2+1" }, ...row.cells.slice(1)],
                }
              : row,
          ),
        },
        range,
        0,
      ),
    ).toContain("Formula");
    expect(
      xlsxSortBlockReason(
        { ...sheet, comments: [{ ref: "A3", text: "moves with data" }] },
        range,
        0,
      ),
    ).toContain("metadata");
    expect(xlsxSortBlockReason(sheet, range, 0, "filtered")).toContain(
      "view-only",
    );
  });
});

function cells(row: number, ...values: string[]) {
  return values.map((value, column) => ({
    ref: `${String.fromCharCode(65 + column)}${row}`,
    value,
  }));
}
