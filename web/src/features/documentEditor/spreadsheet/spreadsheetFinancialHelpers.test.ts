import { describe, expect, it } from "vitest";
import {
  spreadsheetFormulaEffectiveRate,
  spreadsheetFormulaIrr,
  spreadsheetFormulaMirr,
  spreadsheetFormulaNominalRate,
  spreadsheetFormulaNpv,
  spreadsheetFormulaStraightLineDepreciation,
} from "./spreadsheetFinancialHelpers";

describe("spreadsheet financial helpers", () => {
  it("calculates rate conversions and rejects invalid periods", () => {
    expect(spreadsheetFormulaEffectiveRate(0.12, 12)).toBeCloseTo(0.126825, 6);
    expect(spreadsheetFormulaNominalRate(0.12682503013196977, 12)).toBeCloseTo(0.12, 10);
    expect(spreadsheetFormulaEffectiveRate(0.12, 0)).toBe("#NUM!");
  });

  it("calculates cash-flow metrics with Excel-compatible period conventions", () => {
    expect(spreadsheetFormulaNpv(0.1, [100, 100, 100])).toBeCloseTo(248.685199, 6);
    expect(spreadsheetFormulaIrr([-100, 60, 60], 0.1)).toBeCloseTo(0.130662, 6);
    expect(spreadsheetFormulaMirr([-100, 60, 60], 0.1, 0.1)).toBeCloseTo(0.122497, 6);
  });

  it("calculates straight-line depreciation and rejects invalid life", () => {
    expect(spreadsheetFormulaStraightLineDepreciation(1000, 100, 3)).toBe(300);
    expect(spreadsheetFormulaStraightLineDepreciation(1000, 100, 0)).toBe("#NUM!");
  });
});
