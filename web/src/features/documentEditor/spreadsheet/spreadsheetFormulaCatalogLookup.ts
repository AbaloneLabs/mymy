import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";

export const SPREADSHEET_LOOKUP_FORMULA_FUNCTIONS: SpreadsheetFormulaFunction[] = [
  {
    name: "INDEX",
    signature: "INDEX(array, row_num, [column_num])",
    description: "Returns a value from a range by row and column.",
    category: "Lookup",
  },
  {
    name: "MATCH",
    signature: "MATCH(lookup_value, lookup_array, [match_type])",
    description: "Returns the 1-based position of a lookup value.",
    category: "Lookup",
  },
  {
    name: "XMATCH",
    signature: "XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])",
    description: "Returns the 1-based position of a lookup value with search options.",
    category: "Lookup",
  },
  {
    name: "XLOOKUP",
    signature: "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])",
    description: "Looks up a value and returns the corresponding result.",
    category: "Lookup",
  },
  {
    name: "VLOOKUP",
    signature: "VLOOKUP(lookup_value, table_array, col_index, [range_lookup])",
    description: "Looks down the first table column and returns a value from another column.",
    category: "Lookup",
  },
  {
    name: "HLOOKUP",
    signature: "HLOOKUP(lookup_value, table_array, row_index, [range_lookup])",
    description: "Looks across the first table row and returns a value from another row.",
    category: "Lookup",
  },
  {
    name: "CHOOSE",
    signature: "CHOOSE(index_num, value1, [value2], ...)",
    description: "Returns a value selected by 1-based index.",
    category: "Lookup",
  },
  {
    name: "FILTER",
    signature: "FILTER(array, include, [if_empty])",
    description: "Returns values where the include array is TRUE.",
    category: "Lookup",
  },
  {
    name: "UNIQUE",
    signature: "UNIQUE(array)",
    description: "Returns unique values from a range.",
    category: "Lookup",
  },
  {
    name: "SORT",
    signature: "SORT(array, [sort_index], [sort_order])",
    description: "Sorts a range by row values.",
    category: "Lookup",
  },
];
