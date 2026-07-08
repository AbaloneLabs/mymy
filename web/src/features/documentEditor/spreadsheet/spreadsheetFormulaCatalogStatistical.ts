import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_STATISTICAL_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "AVERAGEIF",
    signature: "AVERAGEIF(range, criteria, [average_range])",
    description: "Averages values whose matching range entries satisfy a criteria expression.",
    category: "Statistical",
  },
  {
    name: "AVERAGEIFS",
    signature: "AVERAGEIFS(average_range, criteria_range1, criteria1, ...)",
    description: "Averages values that satisfy multiple criteria ranges.",
    category: "Statistical",
  },
  {
    name: "COUNTIF",
    signature: "COUNTIF(range, criteria)",
    description: "Counts values that satisfy a criteria expression.",
    category: "Statistical",
  },
  {
    name: "COUNTIFS",
    signature: "COUNTIFS(criteria_range1, criteria1, ...)",
    description: "Counts rows that satisfy multiple criteria ranges.",
    category: "Statistical",
  },
  {
    name: "COUNTBLANK",
    signature: "COUNTBLANK(range)",
    description: "Counts blank values in the supplied values or ranges.",
    category: "Statistical",
  },
  {
    name: "STDEV.S",
    signature: "STDEV.S(number1, [number2], ...)",
    description: "Returns sample standard deviation.",
    category: "Statistical",
  },
  {
    name: "STDEV.P",
    signature: "STDEV.P(number1, [number2], ...)",
    description: "Returns population standard deviation.",
    category: "Statistical",
  },
  {
    name: "VAR.S",
    signature: "VAR.S(number1, [number2], ...)",
    description: "Returns sample variance.",
    category: "Statistical",
  },
  {
    name: "VAR.P",
    signature: "VAR.P(number1, [number2], ...)",
    description: "Returns population variance.",
    category: "Statistical",
  },
  {
    name: "LARGE",
    signature: "LARGE(array, k)",
    description: "Returns the k-th largest numeric value.",
    category: "Statistical",
  },
  {
    name: "SMALL",
    signature: "SMALL(array, k)",
    description: "Returns the k-th smallest numeric value.",
    category: "Statistical",
  },
  {
    name: "PERCENTILE.INC",
    signature: "PERCENTILE.INC(array, k)",
    description: "Returns an inclusive percentile.",
    category: "Statistical",
  },
  {
    name: "QUARTILE.INC",
    signature: "QUARTILE.INC(array, quart)",
    description: "Returns an inclusive quartile.",
    category: "Statistical",
  },
];
