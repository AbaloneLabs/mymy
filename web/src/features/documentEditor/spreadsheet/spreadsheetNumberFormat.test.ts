import { describe, expect, it } from "vitest";
import { formatXlsxValue, renderedXlsxCellValue } from "./spreadsheetNumberFormat";

describe("spreadsheet number display", () => {
  it("formats supported numeric values without changing their raw input", () => {
    expect(formatXlsxValue("1234.5", "0.00")).toBe("1234.50");
    expect(formatXlsxValue("1234.5", "$#,##0.00")).toMatch(/^\$1[,.]234[,.]50$/);
    expect(formatXlsxValue("0.125", "0.00%")).toBe("12.50%");
  });

  it("renders Excel serial dates in UTC for deterministic round trips", () => {
    expect(formatXlsxValue("45292", "m/d/yy")).toBe("1/1/24");
    expect(formatXlsxValue("45292.5", "m/d/yy h:mm")).toBe("1/1/24 12:00");
  });

  it("keeps formulas and unknown formats out of the raw-value path", () => {
    const cell = {
      ref: "A1",
      value: "1234.5",
      formula: "B1+1",
      numberFormat: "0.00",
    };
    expect(renderedXlsxCellValue(cell)).toBe("1234.50");
    expect(renderedXlsxCellValue(cell, true)).toBe("=B1+1");
    expect(formatXlsxValue("00123", "unsupported-custom")).toBe("00123");
  });
});
