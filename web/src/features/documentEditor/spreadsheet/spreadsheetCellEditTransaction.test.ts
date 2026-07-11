import { describe, expect, test } from "vitest";

import { spreadsheetCellEditCommitValue } from "./spreadsheetCellEditTransaction";

describe("spreadsheet cell edit transaction", () => {
  test("commits one changed draft and ignores an unchanged edit", () => {
    expect(spreadsheetCellEditCommitValue("A", "A'", false)).toBe("A'");
    expect(spreadsheetCellEditCommitValue("A", "A", false)).toBeNull();
  });

  test("cancels without emitting a compensating workbook mutation", () => {
    expect(spreadsheetCellEditCommitValue("A", "A'", true)).toBeNull();
  });
});
