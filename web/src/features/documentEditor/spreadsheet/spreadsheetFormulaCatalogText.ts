import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_TEXT_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "LEN",
    signature: "LEN(text)",
    description: "Returns the number of characters in text.",
    category: "Text",
  },
  {
    name: "CONCAT",
    signature: "CONCAT(value1, [value2], ...)",
    description: "Joins values into one text value.",
    category: "Text",
  },
  {
    name: "CONCATENATE",
    signature: "CONCATENATE(value1, [value2], ...)",
    description: "Joins values into one text value.",
    category: "Text",
  },
  {
    name: "TEXTJOIN",
    signature: "TEXTJOIN(delimiter, ignore_empty, text1, ...)",
    description: "Joins text values with a delimiter.",
    category: "Text",
  },
  {
    name: "LEFT",
    signature: "LEFT(text, [count])",
    description: "Returns characters from the start of text.",
    category: "Text",
  },
  {
    name: "RIGHT",
    signature: "RIGHT(text, [count])",
    description: "Returns characters from the end of text.",
    category: "Text",
  },
  {
    name: "MID",
    signature: "MID(text, start, count)",
    description: "Returns characters from the middle of text.",
    category: "Text",
  },
  {
    name: "LOWER",
    signature: "LOWER(text)",
    description: "Converts text to lowercase.",
    category: "Text",
  },
  {
    name: "UPPER",
    signature: "UPPER(text)",
    description: "Converts text to uppercase.",
    category: "Text",
  },
  {
    name: "TRIM",
    signature: "TRIM(text)",
    description: "Removes extra spaces from text.",
    category: "Text",
  },
  {
    name: "SUBSTITUTE",
    signature: "SUBSTITUTE(text, old_text, new_text, [instance])",
    description: "Replaces matching text occurrences.",
    category: "Text",
  },
  {
    name: "REPLACE",
    signature: "REPLACE(old_text, start, count, new_text)",
    description: "Replaces a character range in text.",
    category: "Text",
  },
  {
    name: "FIND",
    signature: "FIND(find_text, within_text, [start])",
    description: "Finds case-sensitive text and returns a 1-based position.",
    category: "Text",
  },
  {
    name: "SEARCH",
    signature: "SEARCH(find_text, within_text, [start])",
    description: "Finds text case-insensitively and returns a 1-based position.",
    category: "Text",
  },
  {
    name: "EXACT",
    signature: "EXACT(text1, text2)",
    description: "Returns TRUE when two text values match exactly.",
    category: "Text",
  },
  {
    name: "VALUE",
    signature: "VALUE(text)",
    description: "Converts a text value to a number.",
    category: "Text",
  },
  {
    name: "NUMBERVALUE",
    signature: "NUMBERVALUE(text, [decimal_separator], [group_separator])",
    description: "Converts localized numeric text to a number.",
    category: "Text",
  },
  {
    name: "CLEAN",
    signature: "CLEAN(text)",
    description: "Removes non-printable control characters.",
    category: "Text",
  },
  {
    name: "TEXTBEFORE",
    signature: "TEXTBEFORE(text, delimiter)",
    description: "Returns text before a delimiter.",
    category: "Text",
  },
  {
    name: "TEXTAFTER",
    signature: "TEXTAFTER(text, delimiter)",
    description: "Returns text after a delimiter.",
    category: "Text",
  },
];
