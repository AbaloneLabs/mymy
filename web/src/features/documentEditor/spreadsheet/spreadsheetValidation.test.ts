import { describe, expect, test } from "vitest";

import { validateXlsxCellInput } from "./spreadsheetValidation";
import type { XlsxSheet } from "../shared/models";

const sheet: XlsxSheet = {
  id: "sheet1",
  name: "Data",
  rows: [
    { index: "1", cells: [{ ref: "A1", value: "Red" }] },
    { index: "2", cells: [{ ref: "A2", value: "Blue" }] },
  ],
};
describe("spreadsheet input validation", () => {
  test("enforces literal and range-backed lists", () => {
    const literalSheet = {
      ...sheet,
      dataValidations: [
        { sqref: "B1", type: "list" as const, formula1: '"Red,Blue"' },
      ],
    };
    expect(validateXlsxCellInput({ sheets: [literalSheet] }, literalSheet, 0, 1, "Red"))
      .toEqual({ valid: true });
    expect(validateXlsxCellInput({ sheets: [literalSheet] }, literalSheet, 0, 1, "Green"))
      .toMatchObject({ valid: false });

    const rangeSheet = {
      ...sheet,
      dataValidations: [
        { sqref: "B1", type: "list" as const, formula1: "$A$1:$A$2" },
      ],
    };
    expect(validateXlsxCellInput({ sheets: [rangeSheet] }, rangeSheet, 0, 1, "Blue"))
      .toEqual({ valid: true });
  });

  test("enforces numeric operators and blocks unsupported custom formulas", () => {
    const numericSheet = {
      ...sheet,
      dataValidations: [
        {
          sqref: "B1",
          type: "whole" as const,
          operator: "between" as const,
          formula1: "1",
          formula2: "5",
        },
      ],
    };
    expect(validateXlsxCellInput({ sheets: [numericSheet] }, numericSheet, 0, 1, "3"))
      .toEqual({ valid: true });
    expect(validateXlsxCellInput({ sheets: [numericSheet] }, numericSheet, 0, 1, "3.5"))
      .toMatchObject({ valid: false });

    const customSheet = {
      ...sheet,
      dataValidations: [
        { sqref: "B1", type: "custom" as const, formula1: "=A1=1" },
      ],
    };
    expect(validateXlsxCellInput({ sheets: [customSheet] }, customSheet, 0, 1, "value"))
      .toMatchObject({ valid: false, reason: "Custom validation formulas are preservation-only" });
  });
});
