import { describe, expect, test } from "vitest";

import {
  buildXlsxSheetDeletionPreview,
  canHideXlsxSheet,
  xlsxSheetDuplicateBlockReason,
} from "./spreadsheetSheetActions";
import type { XlsxSheet } from "../shared/models";

const plainSheet: XlsxSheet = {
  id: "xl/worksheets/sheet1.xml",
  name: "Sheet1",
  rows: [{ index: "1", cells: [{ ref: "A1", value: "value" }] }],
};

describe("spreadsheet sheet lifecycle guards", () => {
  test("keeps at least one visible worksheet", () => {
    expect(canHideXlsxSheet([plainSheet], plainSheet.id)).toBe(false);
    expect(
      canHideXlsxSheet(
        [plainSheet, { ...plainSheet, id: "sheet2", name: "Sheet2" }],
        plainSheet.id,
      ),
    ).toBe(true);
    expect(
      canHideXlsxSheet(
        [{ ...plainSheet, state: "hidden" }],
        plainSheet.id,
      ),
    ).toBe(true);
  });

  test("blocks relationship-backed objects instead of creating a lossy duplicate", () => {
    expect(xlsxSheetDuplicateBlockReason(plainSheet)).toBeNull();
    expect(
      xlsxSheetDuplicateBlockReason({
        ...plainSheet,
        charts: [{ id: "rId1", path: "xl/charts/chart1.xml" }],
      }),
    ).toBe("Charts cannot be duplicated safely yet");
  });

  test("builds a stable delete preview without mutating the workbook", () => {
    const summary: XlsxSheet = {
      id: "sheet2",
      name: "Summary",
      rows: [
        { index: "1", cells: [{ ref: "A1", value: "", formula: "Sheet1!A1" }] },
      ],
    };
    const model = { sheets: [plainSheet, summary] };
    const preview = buildXlsxSheetDeletionPreview(model, plainSheet);

    expect(preview).toMatchObject({
      sheetId: plainSheet.id,
      populatedCells: 1,
      ownedObjects: 0,
      impacts: [{ kind: "cellFormula", owner: "Summary!A1", formula: "Sheet1!A1" }],
    });
    expect(model.sheets).toEqual([plainSheet, summary]);
  });
});
