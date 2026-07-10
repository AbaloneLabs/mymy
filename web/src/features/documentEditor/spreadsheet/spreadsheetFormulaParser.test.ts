import { describe, expect, it } from "vitest";
import { evaluateSpreadsheetFormula } from "./spreadsheetFormulaParser";

describe("spreadsheet formula parser", () => {
  it("evaluates arithmetic, ranges, and lookup functions through workbook context", () => {
    const values = new Map<string, number | string>([
      ["A1", "north"],
      ["A2", "south"],
      ["B1", 10],
      ["B2", 15],
      ["C1", 2],
      ["C2", 3],
    ]);

    const result = evaluateSpreadsheetFormula(
      "SUM(B1:B2)+XLOOKUP(\"south\",A1:A2,C1:C2)",
      {
        valueForRef: (reference) => values.get(reference) ?? "",
      },
    );

    expect(result).toBe(28);
  });

  it("returns spill arrays for dynamic array functions", () => {
    const result = evaluateSpreadsheetFormula("UNIQUE(A1:A4)", {
      valueForRef: (reference) =>
        ({
          A1: "alpha",
          A2: "beta",
          A3: "alpha",
          A4: "gamma",
        })[reference] ?? "",
    });

    expect(result).toEqual({
      kind: "array",
      values: ["alpha", "beta", "gamma"],
      width: 1,
      height: 3,
    });
  });

  it("propagates spreadsheet error literals through arithmetic", () => {
    expect(
      evaluateSpreadsheetFormula("A1+10", {
        valueForRef: () => "#VALUE!",
      }),
    ).toBe("#VALUE!");
  });
});
