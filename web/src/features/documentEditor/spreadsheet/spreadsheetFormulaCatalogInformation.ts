import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_INFORMATION_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "ISBLANK",
    signature: "ISBLANK(value)",
    description: "Returns TRUE when the value is blank.",
    category: "Information",
  },
  {
    name: "ISNUMBER",
    signature: "ISNUMBER(value)",
    description: "Returns TRUE when the value is numeric.",
    category: "Information",
  },
  {
    name: "ISTEXT",
    signature: "ISTEXT(value)",
    description: "Returns TRUE when the value is text.",
    category: "Information",
  },
  {
    name: "ISERROR",
    signature: "ISERROR(value)",
    description: "Returns TRUE when the value is any spreadsheet error.",
    category: "Information",
  },
  {
    name: "ISNA",
    signature: "ISNA(value)",
    description: "Returns TRUE when the value is #N/A.",
    category: "Information",
  },
];
