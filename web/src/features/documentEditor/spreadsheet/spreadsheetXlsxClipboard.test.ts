import { describe, expect, test } from "vitest";
import type { XlsxSheet } from "../shared/models";
import {
  applyXlsxClipboardPayload,
  buildXlsxClipboardPayload,
  parseXlsxClipboardPayload,
  serializeXlsxClipboardPayload,
} from "./spreadsheetXlsxClipboard";

const sheet: XlsxSheet = {
  id: "sheet1",
  name: "Sheet1",
  rows: [
    {
      index: "1",
      cells: [
        { ref: "A1", value: "10", bold: true, fillColor: "#ffeeaa" },
        { ref: "B1", value: "label", italic: true },
      ],
    },
    {
      index: "2",
      cells: [
        { ref: "A2", value: "20" },
        { ref: "B2", value: "20", formula: "A1+$A$1", numberFormat: "0.00" },
      ],
    },
  ],
  mergedRanges: [{ ref: "A1:B1" }],
  dataValidations: [
    { sqref: "A1:A2", type: "whole", formula1: "0", operator: "greaterThan" },
  ],
  conditionalFormattings: [
    { sqref: "B2", rules: [{ type: "cellIs", operator: "greaterThan", formulas: ["A1"] }] },
  ],
  hyperlinks: [{ ref: "B1", target: "https://example.com" }],
  comments: [{ ref: "A2", author: "User", text: "keep" }],
};

describe("XLSX internal clipboard", () => {
  test("round-trips raw cells, formulas, styles, merges, and range metadata", () => {
    const built = buildXlsxClipboardPayload(sheet, [
      { top: 0, right: 1, bottom: 1, left: 0 },
    ]);
    expect(built.reason).toBeNull();
    if (!built.payload) throw new Error("expected rich clipboard payload");
    const parsed = parseXlsxClipboardPayload(
      serializeXlsxClipboardPayload(built.payload),
    );
    if (!parsed) throw new Error("expected parsed clipboard payload");

    const result = applyXlsxClipboardPayload(
      { sheets: [sheet] },
      sheet.id,
      { row: 3, column: 3 },
      parsed,
    );
    expect(result.reason).toBeNull();
    if (!result.model) throw new Error("expected pasted workbook");
    const pasted = result.model.sheets[0];
    expect(pasted.rows[3]?.cells[3]).toMatchObject({
      ref: "D4",
      value: "10",
      bold: true,
      fillColor: "#ffeeaa",
    });
    expect(pasted.rows[4]?.cells[4]).toMatchObject({
      ref: "E5",
      formula: "D4+$A$1",
      numberFormat: "0.00",
    });
    expect(pasted.mergedRanges).toContainEqual({ ref: "D4:E4" });
    expect(pasted.dataValidations).toContainEqual(
      expect.objectContaining({ sqref: "D4:D5", type: "whole" }),
    );
    expect(pasted.conditionalFormattings).toContainEqual(
      expect.objectContaining({
        sqref: "E5:E5",
        rules: [expect.objectContaining({ formulas: ["D4"] })],
      }),
    );
    expect(pasted.hyperlinks).toContainEqual(
      expect.objectContaining({ ref: "E4:E4", target: "https://example.com" }),
    );
    expect(pasted.comments).toContainEqual(
      expect.objectContaining({ ref: "D5:D5", text: "keep" }),
    );
  });

  test("blocks partial merges and complex formula groups", () => {
    expect(
      buildXlsxClipboardPayload(sheet, [
        { top: 0, right: 0, bottom: 0, left: 0 },
      ]).reason,
    ).toContain("complete merged range");
    const complex: XlsxSheet = {
      ...sheet,
      mergedRanges: [],
      rows: [
        {
          index: "1",
          cells: [
            { ref: "A1", value: "1", formula: "SUM(A1:A2)", formulaType: "array" },
          ],
        },
      ],
    };
    expect(
      buildXlsxClipboardPayload(complex, [
        { top: 0, right: 0, bottom: 0, left: 0 },
      ]).reason,
    ).toContain("formula groups");
  });

  test("rejects spoofed opaque XML in clipboard payloads", () => {
    expect(
      parseXlsxClipboardPayload(
        JSON.stringify({
          version: 1,
          sourceSheetId: "sheet1",
          sourceOrigin: { row: 0, column: 0 },
          ranges: [
            {
              range: { top: 0, right: 0, bottom: 0, left: 0 },
              cells: [[{ ref: "A1", value: "safe" }]],
            },
          ],
          mergedRanges: [],
          dataValidations: [],
          conditionalFormattings: [
            { sqref: "A1", rules: [{ type: "cellIs", sourceXml: "<unsafe/>" }] },
          ],
          hyperlinks: [],
          comments: [],
        }),
      ),
    ).toBeNull();
  });
});
