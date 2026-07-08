import type { SpreadsheetFormulaEvaluator } from "./spreadsheetFormulaTypes";
import {
  spreadsheetFormulaCashFlowSeries,
  spreadsheetFormulaIrr,
  spreadsheetFormulaMirr,
  spreadsheetFormulaNpv,
} from "./spreadsheetFinancialCashFlowHelpers";
import {
  spreadsheetFormulaCumulativePayment,
  spreadsheetFormulaFv,
  spreadsheetFormulaIpmt,
  spreadsheetFormulaNper,
  spreadsheetFormulaPmt,
  spreadsheetFormulaPpmt,
  spreadsheetFormulaPv,
  spreadsheetFormulaRate,
} from "./spreadsheetFinancialLoanHelpers";
import {
  spreadsheetFormulaDoubleDecliningDepreciation,
  spreadsheetFormulaFixedDecliningDepreciation,
  spreadsheetFormulaStraightLineDepreciation,
  spreadsheetFormulaSumOfYearsDepreciation,
} from "./spreadsheetFinancialDepreciationHelpers";
import {
  spreadsheetFormulaEffectiveRate,
  spreadsheetFormulaEquivalentRate,
  spreadsheetFormulaNominalRate,
} from "./spreadsheetFinancialRateHelpers";
import { spreadsheetFormulaValueNumber } from "./spreadsheetFormulaValues";

export const SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS: Record<
  string,
  SpreadsheetFormulaEvaluator
> = {
  PV: (_args, numbers) =>
    spreadsheetFormulaPv(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  FV: (_args, numbers) =>
    spreadsheetFormulaFv(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  NPER: (_args, numbers) =>
    spreadsheetFormulaNper(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  RATE: (_args, numbers) =>
    spreadsheetFormulaRate(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0.1,
    ),
  NPV: (_args, numbers) => spreadsheetFormulaNpv(numbers[0] ?? 0, numbers.slice(1)),
  IRR: (args, numbers) =>
    spreadsheetFormulaIrr(
      spreadsheetFormulaCashFlowSeries(args, numbers, 0),
      spreadsheetFormulaValueNumber(args[1] ?? 0.1),
    ),
  MIRR: (args, numbers) => {
    const series = spreadsheetFormulaCashFlowSeries(args, numbers, 2);
    const financeRate =
      args.length > 1
        ? spreadsheetFormulaValueNumber(args[1])
        : (numbers.at(-2) ?? 0);
    const reinvestRate =
      args.length > 2
        ? spreadsheetFormulaValueNumber(args[2])
        : (numbers.at(-1) ?? 0);
    return spreadsheetFormulaMirr(series, financeRate, reinvestRate);
  },
  PMT: (_args, numbers) =>
    spreadsheetFormulaPmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  IPMT: (_args, numbers) =>
    spreadsheetFormulaIpmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
    ),
  PPMT: (_args, numbers) =>
    spreadsheetFormulaPpmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
    ),
  CUMIPMT: (_args, numbers) =>
    spreadsheetFormulaCumulativePayment(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
      "interest",
    ),
  CUMPRINC: (_args, numbers) =>
    spreadsheetFormulaCumulativePayment(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
      "principal",
    ),
  SLN: (_args, numbers) =>
    spreadsheetFormulaStraightLineDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
    ),
  SYD: (_args, numbers) =>
    spreadsheetFormulaSumOfYearsDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
    ),
  DB: (_args, numbers) =>
    spreadsheetFormulaFixedDecliningDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 12,
    ),
  DDB: (_args, numbers) =>
    spreadsheetFormulaDoubleDecliningDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 2,
    ),
  EFFECT: (_args, numbers) =>
    spreadsheetFormulaEffectiveRate(numbers[0] ?? 0, numbers[1] ?? 0),
  NOMINAL: (_args, numbers) =>
    spreadsheetFormulaNominalRate(numbers[0] ?? 0, numbers[1] ?? 0),
  RRI: (_args, numbers) =>
    spreadsheetFormulaEquivalentRate(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
    ),
};
