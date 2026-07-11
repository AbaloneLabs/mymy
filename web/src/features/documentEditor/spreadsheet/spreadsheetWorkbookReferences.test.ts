import { describe, expect, test } from "vitest";

import {
  analyzeXlsxSheetDeletion,
  invalidateXlsxWorkbookSheetReferences,
  renameXlsxWorkbookSheetReferences,
  transformXlsxWorkbookReferencesForStructureEdit,
} from "./spreadsheetWorkbookReferences";
import type { XlsxModel } from "../shared/models";

const model: XlsxModel = {
  sheets: [
    {
      id: "target",
      name: "Data",
      rows: [
        {
          index: "1",
          cells: [{ ref: "A1", value: "1", formula: "SUM(A1:A3)" }],
        },
      ],
      mergedRanges: [{ ref: "A1:B3" }],
      charts: [
        {
          id: "chart",
          series: [{ valuesFormula: "Data!$A$1:$A$3" }],
          anchor: { from: { row: 1, column: 2 }, to: { row: 4, column: 5 } },
        },
      ],
    },
    {
      id: "summary",
      name: "Summary",
      rows: [
        {
          index: "1",
          cells: [{ ref: "A1", value: "", formula: "Data!A3+A1" }],
        },
      ],
    },
  ],
  definedNames: [{ name: "Local", value: "$A$1:$A$3", localSheetId: 0 }],
};

describe("spreadsheet workbook reference transformation", () => {
  test("updates local, cross-sheet, merged, chart, anchor, and name owners together", () => {
    const transformed = transformXlsxWorkbookReferencesForStructureEdit(
      model,
      "target",
      { axis: "row", kind: "insert", index: 1 },
    );

    expect(transformed.sheets[0].rows[0].cells[0].formula).toBe("SUM(A1:A4)");
    expect(transformed.sheets[1].rows[0].cells[0].formula).toBe("Data!A4+A1");
    expect(transformed.sheets[0].mergedRanges?.[0].ref).toBe("A1:B4");
    expect(transformed.sheets[0].charts?.[0].series?.[0].valuesFormula).toBe(
      "Data!$A$1:$A$4",
    );
    expect(transformed.sheets[0].charts?.[0].anchor?.from?.row).toBe(2);
    expect(transformed.definedNames?.[0].value).toBe("$A$1:$A$4");
  });

  test("renames every explicit formula owner while preserving unqualified references", () => {
    const renamed = renameXlsxWorkbookSheetReferences(model, "Data", "Input Data");

    expect(renamed.sheets[1].rows[0].cells[0].formula).toBe(
      "'Input Data'!A3+A1",
    );
    expect(renamed.sheets[0].charts?.[0].series?.[0].valuesFormula).toBe(
      "'Input Data'!$A$1:$A$3",
    );
    expect(renamed.definedNames?.[0].value).toBe("$A$1:$A$3");
  });

  test("previews every durable owner and makes deletion damage explicit", () => {
    const deletionModel: XlsxModel = {
      sheets: [
        model.sheets[0],
        {
          ...model.sheets[1],
          dataValidations: [{ sqref: "B1", formula1: "Data!A1:A3" }],
          conditionalFormattings: [
            { sqref: "C1", rules: [{ type: "expression", formulas: ["Data!A1>0"] }] },
          ],
          hyperlinks: [{ ref: "D1", location: "Data!A1" }],
          charts: [
            {
              id: "summary-chart",
              series: [{ valuesFormula: "Data!$A$1:$A$3" }],
            },
          ],
        },
      ],
      definedNames: [
        { name: "DeletedData", value: "Data!$A$1:$A$3" },
      ],
    };

    const impacts = analyzeXlsxSheetDeletion(deletionModel, "target");
    expect(new Set(impacts.map((impact) => impact.kind))).toEqual(
      new Set([
        "cellFormula",
        "dataValidation",
        "conditionalFormatting",
        "hyperlink",
        "chartSeries",
        "definedName",
      ]),
    );

    const invalidated = invalidateXlsxWorkbookSheetReferences(deletionModel, "Data");
    const summary = invalidated.sheets[1];
    expect(summary.rows[0].cells[0].formula).toBe("#REF!+A1");
    expect(summary.dataValidations?.[0].formula1).toBe("#REF!");
    expect(summary.conditionalFormattings?.[0].rules[0].formulas?.[0]).toBe(
      "#REF!>0",
    );
    expect(summary.hyperlinks?.[0].location).toBe("#REF!");
    expect(summary.charts?.[0].series?.[0].valuesFormula).toBe("#REF!");
    expect(invalidated.definedNames?.[0].value).toBe("#REF!");
  });
});
