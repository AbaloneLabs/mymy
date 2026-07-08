import type { SpreadsheetFormulaValue } from "./spreadsheetFormulaValues";

export interface SpreadsheetFormulaFunction {
  name: string;
  signature: string;
  description: string;
  category:
    | "Math"
    | "Statistical"
    | "Logical"
    | "Text"
    | "Date"
    | "Financial"
    | "Engineering"
    | "Information"
    | "Lookup";
}

export type SpreadsheetFormulaEvaluator = (
  args: SpreadsheetFormulaValue[],
  numbers: number[],
) => SpreadsheetFormulaValue;

export interface SpreadsheetFormulaEvaluationContext {
  valueForRef: (reference: string) => SpreadsheetFormulaValue;
  valuesForRange?: (startRef: string, endRef: string) => SpreadsheetFormulaValue[];
  valuesForName?: (name: string) => SpreadsheetFormulaValue[];
  valuesForStructuredReference?: (reference: string) =>
    | {
        height: number;
        values: SpreadsheetFormulaValue[];
        width: number;
      }
    | null;
}
