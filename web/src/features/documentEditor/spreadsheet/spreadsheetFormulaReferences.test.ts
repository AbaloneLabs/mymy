import { describe, expect, test } from "vitest";

import {
  adjustSpreadsheetFormulaReferences,
  renameSpreadsheetFormulaSheetReferences,
  transformSpreadsheetFormulaForStructuralEdit,
} from "./spreadsheetFormulaReferences";

describe("spreadsheet structural formula references", () => {
  test("copy offsets skip strings, function names, and structured references", () => {
    expect(
      adjustSpreadsheetFormulaReferences(
        'LOG10(A1)+"A1"+Table1[A1]+$B$2',
        1,
        0,
      ),
    ).toBe('LOG10(A2)+"A1"+Table1[A1]+$B$2');
  });

  test("inserts rows into local and qualified ranges while preserving locks", () => {
    expect(
      transformSpreadsheetFormulaForStructuralEdit(
        'SUM(A1:A3)+$B$2+Other!A1+"A1"+LOG10(A1)+Table1[A1]',
        "Sheet1",
        "Sheet1",
        { axis: "row", kind: "insert", index: 1 },
      ),
    ).toBe('SUM(A1:A4)+$B$3+Other!A1+"A1"+LOG10(A1)+Table1[A1]');
  });

  test("shrinks a deleted range and emits REF only for a deleted single cell", () => {
    expect(
      transformSpreadsheetFormulaForStructuralEdit(
        "SUM(A1:A3)+A1+C4",
        "Sheet1",
        "Sheet1",
        { axis: "row", kind: "delete", index: 0 },
      ),
    ).toBe("SUM(A1:A2)+#REF!+C3");
  });

  test("changes only references that resolve to the target sheet", () => {
    expect(
      transformSpreadsheetFormulaForStructuralEdit(
        "A2+Target!A2+'Target'!B2",
        "Other",
        "Target",
        { axis: "row", kind: "insert", index: 0 },
      ),
    ).toBe("A2+Target!A3+'Target'!B3");
  });

  test("renames explicit sheet references without touching strings", () => {
    expect(
      renameSpreadsheetFormulaSheetReferences(
        `'Old Sheet'!$A$1+SUM('Old Sheet'!B2:B4)+"Old Sheet!A1"`,
        "Old Sheet",
        "New Name",
      ),
    ).toBe(`'New Name'!$A$1+SUM('New Name'!B2:B4)+"Old Sheet!A1"`);
  });
});
