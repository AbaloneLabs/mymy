import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_LOGICAL_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "IF",
    signature: "IF(test, value_if_true, value_if_false)",
    description: "Returns one value when a condition is true and another when false.",
    category: "Logical",
  },
  {
    name: "AND",
    signature: "AND(condition1, [condition2], ...)",
    description: "Returns TRUE when every argument is true.",
    category: "Logical",
  },
  {
    name: "OR",
    signature: "OR(condition1, [condition2], ...)",
    description: "Returns TRUE when any argument is true.",
    category: "Logical",
  },
  {
    name: "NOT",
    signature: "NOT(condition)",
    description: "Reverses a logical value.",
    category: "Logical",
  },
  {
    name: "TRUE",
    signature: "TRUE()",
    description: "Returns the logical value TRUE.",
    category: "Logical",
  },
  {
    name: "FALSE",
    signature: "FALSE()",
    description: "Returns the logical value FALSE.",
    category: "Logical",
  },
  {
    name: "XOR",
    signature: "XOR(condition1, [condition2], ...)",
    description: "Returns TRUE when an odd number of arguments are true.",
    category: "Logical",
  },
  {
    name: "IFERROR",
    signature: "IFERROR(value, value_if_error)",
    description: "Returns a fallback when the first value is an error.",
    category: "Logical",
  },
  {
    name: "IFNA",
    signature: "IFNA(value, value_if_na)",
    description: "Returns a fallback when the first value is #N/A.",
    category: "Logical",
  },
  {
    name: "IFS",
    signature: "IFS(test1, value1, [test2, value2], ...)",
    description: "Returns the value for the first TRUE condition.",
    category: "Logical",
  },
  {
    name: "SWITCH",
    signature: "SWITCH(expression, value1, result1, ..., [default])",
    description: "Matches an expression against values and returns a result.",
    category: "Logical",
  },
];
