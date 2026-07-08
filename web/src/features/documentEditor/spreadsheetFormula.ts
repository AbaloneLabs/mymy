import { columnName } from "./models";
import {
  spreadsheetFormulaAverageIf,
  spreadsheetFormulaAverageIfs,
  spreadsheetFormulaCountIf,
  spreadsheetFormulaCountIfs,
  spreadsheetFormulaSumIf,
  spreadsheetFormulaSumIfs,
} from "./spreadsheetFormulaCriteria";
import { SPREADSHEET_ENGINEERING_FORMULA_EVALUATORS } from "./spreadsheetEngineeringFormulas";
import { SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS } from "./spreadsheetFinancialFormulas";
import {
  compareSpreadsheetFormulaValues,
  isSpreadsheetFormulaError,
  isSpreadsheetFormulaNa,
  spreadsheetFormulaArray,
  spreadsheetFormulaAsArray,
  spreadsheetFormulaFirstError,
  spreadsheetFormulaFlattenValues,
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
  spreadsheetFormulaValuesEqual,
  spreadsheetFormulaValueText,
  wildcardSpreadsheetFormulaPattern,
} from "./spreadsheetFormulaValues";
import type { SpreadsheetFormulaValue } from "./spreadsheetFormulaValues";

export {
  formatSpreadsheetFormulaResult,
  isSpreadsheetFormulaArray,
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
} from "./spreadsheetFormulaValues";
export type {
  SpreadsheetFormulaArray,
  SpreadsheetFormulaScalar,
  SpreadsheetFormulaValue,
} from "./spreadsheetFormulaValues";

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

export { SPREADSHEET_FORMULA_FUNCTIONS } from "./spreadsheetFormulaCatalog";
type SpreadsheetFormulaToken =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "error"; value: string }
  | { type: "identifier"; value: string }
  | { type: "structuredReference"; value: string }
  | { type: "operator"; value: string };

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

const SPREADSHEET_FORMULA_EVALUATORS: Record<string, SpreadsheetFormulaEvaluator> = {
  SUM: (_args, numbers) => numbers.reduce((total, value) => total + value, 0),
  AVERAGE: (_args, numbers) =>
    numbers.length === 0
      ? 0
      : numbers.reduce((total, value) => total + value, 0) / numbers.length,
  COUNT: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) =>
        spreadsheetFormulaValueText(value) !== "" && Number.isFinite(Number(value)),
    ).length,
  COUNTIF: (args) => spreadsheetFormulaCountIf(args[0], args[1]),
  COUNTIFS: (args) => spreadsheetFormulaCountIfs(args),
  COUNTA: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) => spreadsheetFormulaValueText(value) !== "",
    ).length,
  SUMIF: (args) => spreadsheetFormulaSumIf(args[0], args[1], args[2]),
  SUMIFS: (args) => spreadsheetFormulaSumIfs(args[0], args.slice(1)),
  AVERAGEIF: (args) => spreadsheetFormulaAverageIf(args[0], args[1], args[2]),
  AVERAGEIFS: (args) => spreadsheetFormulaAverageIfs(args[0], args.slice(1)),
  MIN: (_args, numbers) => (numbers.length === 0 ? 0 : Math.min(...numbers)),
  MAX: (_args, numbers) => (numbers.length === 0 ? 0 : Math.max(...numbers)),
  ABS: (_args, numbers) => Math.abs(numbers[0] ?? 0),
  ROUND: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    const multiplier = 10 ** places;
    return Math.round((numbers[0] ?? 0) * multiplier) / multiplier;
  },
  ROUNDUP: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    return roundSpreadsheetFormulaNumber(numbers[0] ?? 0, places, "away");
  },
  ROUNDDOWN: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    return roundSpreadsheetFormulaNumber(numbers[0] ?? 0, places, "toward");
  },
  POWER: (_args, numbers) => (numbers[0] ?? 0) ** (numbers[1] ?? 0),
  SQRT: (_args, numbers) => Math.sqrt(numbers[0] ?? 0),
  PRODUCT: (_args, numbers) =>
    numbers.length === 0
      ? 0
      : numbers.reduce((total, value) => total * value, 1),
  MEDIAN: (_args, numbers) => {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  },
  MOD: (_args, numbers) => {
    const divisor = numbers[1] ?? 0;
    if (divisor === 0) return 0;
    return (numbers[0] ?? 0) - divisor * Math.floor((numbers[0] ?? 0) / divisor);
  },
  INT: (_args, numbers) => Math.floor(numbers[0] ?? 0),
  CEILING: (_args, numbers) =>
    roundSpreadsheetFormulaMultiple(numbers[0] ?? 0, numbers[1] ?? 1, "up"),
  FLOOR: (_args, numbers) =>
    roundSpreadsheetFormulaMultiple(numbers[0] ?? 0, numbers[1] ?? 1, "down"),
  SUMSQ: (_args, numbers) =>
    numbers.reduce((total, value) => total + value * value, 0),
  SIGN: (_args, numbers) => Math.sign(numbers[0] ?? 0),
  TRUNC: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    const multiplier = 10 ** places;
    return Math.trunc((numbers[0] ?? 0) * multiplier) / multiplier;
  },
  MROUND: (_args, numbers) => {
    const multiple = numbers[1] ?? 0;
    if (multiple === 0) return 0;
    return Math.round((numbers[0] ?? 0) / multiple) * multiple;
  },
  ODD: (_args, numbers) => roundSpreadsheetFormulaOddEven(numbers[0] ?? 0, "odd"),
  EVEN: (_args, numbers) => roundSpreadsheetFormulaOddEven(numbers[0] ?? 0, "even"),
  RAND: () => Math.random(),
  RANDBETWEEN: (_args, numbers) => {
    const bottom = Math.ceil(Math.min(numbers[0] ?? 0, numbers[1] ?? 0));
    const top = Math.floor(Math.max(numbers[0] ?? 0, numbers[1] ?? 0));
    return Math.floor(Math.random() * (top - bottom + 1)) + bottom;
  },
  COUNTBLANK: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) => spreadsheetFormulaValueText(value) === "",
    ).length,
  "STDEV.S": (_args, numbers) => spreadsheetFormulaStandardDeviation(numbers, true),
  "STDEV.P": (_args, numbers) => spreadsheetFormulaStandardDeviation(numbers, false),
  "VAR.S": (_args, numbers) => spreadsheetFormulaVariance(numbers, true),
  "VAR.P": (_args, numbers) => spreadsheetFormulaVariance(numbers, false),
  LARGE: (_args, numbers) =>
    spreadsheetFormulaNthSorted(
      numbers.slice(0, -1),
      Math.trunc(numbers.at(-1) ?? 1),
      "desc",
    ),
  SMALL: (_args, numbers) =>
    spreadsheetFormulaNthSorted(
      numbers.slice(0, -1),
      Math.trunc(numbers.at(-1) ?? 1),
      "asc",
    ),
  "PERCENTILE.INC": (_args, numbers) =>
    spreadsheetFormulaPercentile(numbers.slice(0, -1), numbers.at(-1) ?? 0),
  "QUARTILE.INC": (_args, numbers) =>
    spreadsheetFormulaPercentile(numbers.slice(0, -1), (numbers.at(-1) ?? 0) / 4),
  IF: (args) =>
    spreadsheetFormulaValueBoolean(args[0])
      ? (args[1] ?? true)
      : (args[2] ?? false),
  AND: (args) => spreadsheetFormulaFlattenValues(args).every(spreadsheetFormulaValueBoolean),
  OR: (args) => spreadsheetFormulaFlattenValues(args).some(spreadsheetFormulaValueBoolean),
  NOT: (args) => !spreadsheetFormulaValueBoolean(args[0]),
  TRUE: () => true,
  FALSE: () => false,
  XOR: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(spreadsheetFormulaValueBoolean).length % 2 === 1,
  IFERROR: (args) => (isSpreadsheetFormulaError(args[0]) ? (args[1] ?? "") : (args[0] ?? "")),
  IFNA: (args) => (isSpreadsheetFormulaNa(args[0]) ? (args[1] ?? "") : (args[0] ?? "")),
  IFS: (args) => {
    for (let index = 0; index < args.length; index += 2) {
      if (spreadsheetFormulaValueBoolean(args[index])) return args[index + 1] ?? true;
    }
    return "#N/A";
  },
  SWITCH: (args) => {
    const expression = args[0];
    for (let index = 1; index + 1 < args.length; index += 2) {
      if (compareSpreadsheetFormulaValues(expression ?? "", args[index] ?? "", "=") === true) {
        return args[index + 1] ?? "";
      }
    }
    return args.length % 2 === 0 ? (args.at(-1) ?? "#N/A") : "#N/A";
  },
  LEN: (args) => spreadsheetFormulaValueText(args[0]).length,
  CONCAT: (args) => spreadsheetFormulaFlattenValues(args).map(spreadsheetFormulaValueText).join(""),
  CONCATENATE: (args) =>
    spreadsheetFormulaFlattenValues(args).map(spreadsheetFormulaValueText).join(""),
  TEXTJOIN: (args) => {
    const delimiter = spreadsheetFormulaValueText(args[0]);
    const ignoreEmpty = spreadsheetFormulaValueBoolean(args[1]);
    return spreadsheetFormulaFlattenValues(args.slice(2))
      .map(spreadsheetFormulaValueText)
      .filter((value) => !ignoreEmpty || value !== "")
      .join(delimiter);
  },
  LEFT: (args, numbers) =>
    spreadsheetFormulaValueText(args[0]).slice(
      0,
      Math.max(0, Math.trunc(numbers[1] ?? 1)),
    ),
  RIGHT: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    return text.slice(Math.max(0, text.length - Math.trunc(numbers[1] ?? 1)));
  },
  MID: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    const start = Math.max(0, Math.trunc(numbers[1] ?? 1) - 1);
    return text.slice(start, start + Math.max(0, Math.trunc(numbers[2] ?? 1)));
  },
  LOWER: (args) => spreadsheetFormulaValueText(args[0]).toLowerCase(),
  UPPER: (args) => spreadsheetFormulaValueText(args[0]).toUpperCase(),
  TRIM: (args) => spreadsheetFormulaValueText(args[0]).trim().replace(/\s+/g, " "),
  SUBSTITUTE: (args, numbers) =>
    substituteSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      spreadsheetFormulaValueText(args[2]),
      numbers[3],
    ),
  REPLACE: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    const start = Math.max(0, Math.trunc(numbers[1] ?? 1) - 1);
    const count = Math.max(0, Math.trunc(numbers[2] ?? 0));
    return `${text.slice(0, start)}${spreadsheetFormulaValueText(args[3])}${text.slice(start + count)}`;
  },
  FIND: (args, numbers) =>
    findSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      numbers[2],
      false,
    ),
  SEARCH: (args, numbers) =>
    findSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      numbers[2],
      true,
    ),
  EXACT: (args) =>
    spreadsheetFormulaValueText(args[0]) === spreadsheetFormulaValueText(args[1]),
  VALUE: (args) => spreadsheetFormulaValueNumber(spreadsheetFormulaValueText(args[0])),
  NUMBERVALUE: (args) =>
    spreadsheetFormulaNumberValue(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1] ?? "."),
      spreadsheetFormulaValueText(args[2] ?? ","),
    ),
  CLEAN: (args) =>
    [...spreadsheetFormulaValueText(args[0])]
      .filter((char) => char.charCodeAt(0) >= 32)
      .join(""),
  TEXTBEFORE: (args) =>
    spreadsheetFormulaTextAroundDelimiter(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      "before",
    ),
  TEXTAFTER: (args) =>
    spreadsheetFormulaTextAroundDelimiter(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      "after",
    ),
  TODAY: () => excelSerialFromDate(new Date()),
  NOW: () => excelSerialFromDateTime(new Date()),
  DATE: (_args, numbers) =>
    excelSerialFromDateParts(
      Math.trunc(numbers[0] ?? 1900),
      Math.trunc(numbers[1] ?? 1),
      Math.trunc(numbers[2] ?? 1),
    ),
  YEAR: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCFullYear(),
  MONTH: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCMonth() + 1,
  DAY: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCDate(),
  HOUR: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCHours(),
  MINUTE: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCMinutes(),
  SECOND: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCSeconds(),
  DAYS: (_args, numbers) => Math.trunc((numbers[0] ?? 0) - (numbers[1] ?? 0)),
  TIME: (_args, numbers) =>
    ((Math.trunc(numbers[0] ?? 0) * 3600 +
      Math.trunc(numbers[1] ?? 0) * 60 +
      Math.trunc(numbers[2] ?? 0)) %
      86400) /
    86400,
  DATEVALUE: (args) => excelSerialFromDateText(spreadsheetFormulaValueText(args[0])),
  WEEKDAY: (_args, numbers) => spreadsheetFormulaWeekday(numbers[0] ?? 0, numbers[1] ?? 1),
  EOMONTH: (_args, numbers) => excelSerialEndOfMonth(numbers[0] ?? 0, numbers[1] ?? 0),
  INDEX: (args) =>
    spreadsheetFormulaIndex(
      args[0],
      Math.trunc(spreadsheetFormulaValueNumber(args[1])),
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
    ),
  MATCH: (args) =>
    spreadsheetFormulaMatch(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 0)),
    ),
  XMATCH: (args) =>
    spreadsheetFormulaXMatch(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 0)),
      Math.trunc(spreadsheetFormulaValueNumber(args[3] ?? 1)),
    ),
  XLOOKUP: (args) =>
    spreadsheetFormulaXLookup(
      args[0] ?? "",
      args[1],
      args[2],
      args[3],
      Math.trunc(spreadsheetFormulaValueNumber(args[4] ?? 0)),
      Math.trunc(spreadsheetFormulaValueNumber(args[5] ?? 1)),
    ),
  VLOOKUP: (args) =>
    spreadsheetFormulaTableLookup(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
      spreadsheetFormulaValueBoolean(args[3] ?? true),
      "vertical",
    ),
  HLOOKUP: (args) =>
    spreadsheetFormulaTableLookup(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
      spreadsheetFormulaValueBoolean(args[3] ?? true),
      "horizontal",
    ),
  CHOOSE: (args) =>
    args[Math.trunc(spreadsheetFormulaValueNumber(args[0] ?? 1))] ?? "#VALUE!",
  FILTER: (args) => spreadsheetFormulaFilter(args[0], args[1], args[2]),
  UNIQUE: (args) => spreadsheetFormulaUnique(args[0]),
  SORT: (args) =>
    spreadsheetFormulaSort(
      args[0],
      Math.trunc(spreadsheetFormulaValueNumber(args[1] ?? 1)),
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
    ),
  ISBLANK: (args) => spreadsheetFormulaValueText(args[0]) === "",
  ISNUMBER: (args) =>
    typeof args[0] === "number" ||
    (spreadsheetFormulaValueText(args[0]) !== "" &&
      Number.isFinite(Number(args[0]))),
  ISTEXT: (args) => typeof args[0] === "string" && !isSpreadsheetFormulaError(args[0]),
  ISERROR: (args) => isSpreadsheetFormulaError(args[0]),
  ISNA: (args) => isSpreadsheetFormulaNa(args[0]),
  ...SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS,
  ...SPREADSHEET_ENGINEERING_FORMULA_EVALUATORS,
};

const SPREADSHEET_FORMULA_ERROR_HANDLERS = new Set(["IFERROR", "IFNA", "ISERROR", "ISNA"]);

export function evaluateSpreadsheetFormula(
  formula: string,
  contextOrValueForRef:
    | SpreadsheetFormulaEvaluationContext
    | ((reference: string) => SpreadsheetFormulaValue),
) {
  const context =
    typeof contextOrValueForRef === "function"
      ? { valueForRef: contextOrValueForRef }
      : contextOrValueForRef;
  return new SpreadsheetFormulaParser(formula, context).parse();
}

export function adjustSpreadsheetFormulaReferences(
  formula: string,
  rowOffset: number,
  columnOffset: number,
) {
  return formula.replace(
    /'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?\d+|[A-Za-z_][A-Za-z0-9_.]*!\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}\$?\d+/g,
    (match, offset: number, source: string) => {
      if (
        spreadsheetFormulaReferenceInsideStructuredReference(source, offset) ||
        spreadsheetFormulaReferenceInsideIdentifier(source, offset, match.length)
      ) {
        return match;
      }
      return adjustSpreadsheetFormulaReferenceToken(match, rowOffset, columnOffset);
    },
  );
}

export function spreadsheetFormulaReferences(
  formula: string,
  options?: {
    referencesForName?: (name: string) => string[];
    referencesForStructuredReference?: (reference: string) => string[];
  },
) {
  try {
    const tokens = tokenizeSpreadsheetFormula(formula);
    const references = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const colon = tokens[index + 1];
      const end = tokens[index + 2];
      if (
        token.type === "identifier" &&
        colon?.type === "operator" &&
        colon.value === ":" &&
        end?.type === "identifier" &&
        isSpreadsheetFormulaCellReference(token.value) &&
        isSpreadsheetFormulaCellReference(end.value)
      ) {
        spreadsheetFormulaRangeReferences(token.value, end.value).forEach((reference) =>
          references.add(reference),
        );
        index += 2;
        continue;
      }
      if (token.type === "identifier" && isSpreadsheetFormulaCellReference(token.value)) {
        references.add(displaySpreadsheetFormulaRef(token.value));
        continue;
      }
      if (token.type === "structuredReference") {
        options?.referencesForStructuredReference?.(token.value).forEach((reference) =>
          references.add(reference),
        );
        continue;
      }
      if (
        token.type === "identifier" &&
        !(tokens[index + 1]?.type === "operator" && tokens[index + 1]?.value === "(") &&
        !isSpreadsheetFormulaCellReference(token.value)
      ) {
        options?.referencesForName?.(token.value).forEach((reference) =>
          references.add(reference),
        );
      }
    }
    return [...references].sort(compareSpreadsheetFormulaRefs);
  } catch {
    return [];
  }
}

class SpreadsheetFormulaParser {
  private readonly tokens: SpreadsheetFormulaToken[];
  private readonly context: SpreadsheetFormulaEvaluationContext;
  private index = 0;

  constructor(
    formula: string,
    context: SpreadsheetFormulaEvaluationContext,
  ) {
    this.tokens = tokenizeSpreadsheetFormula(formula);
    this.context = context;
  }

  parse() {
    const value = this.parseExpression();
    if (this.peek()) throw new Error("Unexpected formula token");
    return value;
  }

  private parseExpression(): SpreadsheetFormulaValue {
    return this.parseComparison();
  }

  private parseComparison(): SpreadsheetFormulaValue {
    let value = this.parseConcat();
    while (
      this.matchOperator("=") ||
      this.matchOperator("<>") ||
      this.matchOperator("<") ||
      this.matchOperator("<=") ||
      this.matchOperator(">") ||
      this.matchOperator(">=")
    ) {
      const operator = this.previous().value;
      const right = this.parseConcat();
      value = compareSpreadsheetFormulaValues(value, right, operator);
    }
    return value;
  }

  private parseConcat(): SpreadsheetFormulaValue {
    let value: SpreadsheetFormulaValue = this.parseAdditive();
    while (this.matchOperator("&")) {
      value = `${spreadsheetFormulaValueText(value)}${spreadsheetFormulaValueText(this.parseAdditive())}`;
    }
    return value;
  }

  private parseAdditive(): SpreadsheetFormulaValue {
    let value = this.parseTerm();
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseTerm();
      const error = spreadsheetFormulaFirstError([value, right]);
      if (error) return error;
      value =
        operator === "+"
          ? spreadsheetFormulaValueNumber(value) + spreadsheetFormulaValueNumber(right)
          : spreadsheetFormulaValueNumber(value) - spreadsheetFormulaValueNumber(right);
    }
    return value;
  }

  private parseTerm(): SpreadsheetFormulaValue {
    let value = this.parsePower();
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parsePower();
      const error = spreadsheetFormulaFirstError([value, right]);
      if (error) return error;
      if (operator === "/" && spreadsheetFormulaValueNumber(right) === 0) {
        return "#DIV/0!";
      }
      value =
        operator === "*"
          ? spreadsheetFormulaValueNumber(value) * spreadsheetFormulaValueNumber(right)
          : spreadsheetFormulaValueNumber(value) / spreadsheetFormulaValueNumber(right);
    }
    return value;
  }

  private parsePower(): SpreadsheetFormulaValue {
    const value = this.parseUnary();
    if (this.matchOperator("^")) {
      const right = this.parsePower();
      const error = spreadsheetFormulaFirstError([value, right]);
      if (error) return error;
      return spreadsheetFormulaValueNumber(value) ** spreadsheetFormulaValueNumber(right);
    }
    return value;
  }

  private parseUnary(): SpreadsheetFormulaValue {
    if (this.matchOperator("+")) {
      return spreadsheetFormulaValueNumber(this.parseUnary());
    }
    if (this.matchOperator("-")) {
      return -spreadsheetFormulaValueNumber(this.parseUnary());
    }
    return this.parsePercent();
  }

  private parsePercent(): SpreadsheetFormulaValue {
    let value = this.parsePrimary();
    while (this.matchOperator("%")) {
      value = spreadsheetFormulaValueNumber(value) / 100;
    }
    return value;
  }

  private parsePrimary(): SpreadsheetFormulaValue {
    if (this.matchOperator("(")) {
      const value = this.parseExpression();
      this.consumeOperator(")");
      return value;
    }
    const token = this.advance();
    if (!token) throw new Error("Expected formula value");
    if (token.type === "number") return Number(token.value);
    if (token.type === "string") return token.value;
    if (token.type === "error") return token.value;
    if (token.type === "structuredReference") {
      return this.structuredReferenceValue(token.value);
    }
    if (token.type === "identifier") {
      if (this.matchOperator("(")) {
        return this.evaluateFunction(token.value);
      }
      if (token.value.toUpperCase() === "TRUE") return true;
      if (token.value.toUpperCase() === "FALSE") return false;
      if (isSpreadsheetFormulaCellReference(token.value)) {
        return this.context.valueForRef(token.value);
      }
      const namedValues = this.context.valuesForName?.(token.value) ?? [];
      if (namedValues.length > 0) return namedValues[0] ?? "";
    }
    throw new Error("Unsupported formula value");
  }

  private evaluateFunction(name: string): SpreadsheetFormulaValue {
    const args: SpreadsheetFormulaValue[] = [];
    if (!this.checkOperator(")")) {
      do {
        args.push(this.parseFunctionArgument());
      } while (this.matchArgumentSeparator());
    }
    this.consumeOperator(")");
    const upper = name.toUpperCase();
    const numbers = spreadsheetFormulaFlattenValues(args).map(spreadsheetFormulaValueNumber);
    const error = spreadsheetFormulaFirstError(args);
    if (error && !SPREADSHEET_FORMULA_ERROR_HANDLERS.has(upper)) return error;
    const evaluator = SPREADSHEET_FORMULA_EVALUATORS[upper];
    if (evaluator) return evaluator(args, numbers);
    throw new Error("Unsupported formula function");
  }

  private parseFunctionArgument(): SpreadsheetFormulaValue {
    const start = this.peek();
    const colon = this.peek(1);
    const end = this.peek(2);
    if (
      start?.type === "identifier" &&
      colon?.type === "operator" &&
      colon.value === ":" &&
      end?.type === "identifier" &&
      isSpreadsheetFormulaCellReference(start.value) &&
      isSpreadsheetFormulaCellReference(end.value)
    ) {
      this.advance();
      this.advance();
      this.advance();
      return this.rangeValue(start.value, end.value);
    }
    if (
      start?.type === "identifier" &&
      !isSpreadsheetFormulaCellReference(start.value) &&
      this.context.valuesForName
    ) {
      const values = this.context.valuesForName(start.value);
      if (values.length > 0) {
        this.advance();
        return spreadsheetFormulaArray(values, values.length, values.length > 0 ? 1 : 0);
      }
    }
    return this.parseExpression();
  }

  private structuredReferenceValue(reference: string) {
    const resolved = this.context.valuesForStructuredReference?.(reference);
    if (!resolved) return "#REF!";
    return spreadsheetFormulaArray(
      resolved.values,
      resolved.width,
      resolved.height,
    );
  }

  private rangeValue(startRef: string, endRef: string) {
    const dimensions = spreadsheetFormulaRangeDimensions(startRef, endRef);
    const values =
      this.context.valuesForRange?.(startRef, endRef) ??
      spreadsheetFormulaRangeReferences(startRef, endRef).map((reference) =>
        this.context.valueForRef(reference),
      );
    return spreadsheetFormulaArray(
      values,
      dimensions?.width ?? values.length,
      dimensions?.height ?? (values.length > 0 ? 1 : 0),
    );
  }

  private matchOperator(value: string) {
    if (!this.checkOperator(value)) return false;
    this.index += 1;
    return true;
  }

  private checkOperator(value: string) {
    const token = this.peek();
    return token?.type === "operator" && token.value === value;
  }

  private consumeOperator(value: string) {
    if (!this.matchOperator(value)) {
      throw new Error(`Expected ${value}`);
    }
  }

  private matchArgumentSeparator() {
    return this.matchOperator(",") || this.matchOperator(";");
  }

  private advance() {
    const token = this.peek();
    if (token) this.index += 1;
    return token;
  }

  private previous() {
    return this.tokens[this.index - 1];
  }

  private peek(offset = 0) {
    return this.tokens[this.index + offset];
  }
}

function tokenizeSpreadsheetFormula(formula: string): SpreadsheetFormulaToken[] {
  const source = formula.trim().replace(/^=/, "");
  const decimalComma = spreadsheetFormulaUsesDecimalComma(source);
  const tokens: SpreadsheetFormulaToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = nextSpreadsheetFormulaNumberToken(source.slice(index), decimalComma);
    if (number) {
      tokens.push({ type: "number", value: number.value });
      index += number.length;
      continue;
    }
    const structuredReference = nextSpreadsheetFormulaStructuredReferenceToken(source.slice(index));
    if (structuredReference) {
      tokens.push({ type: "structuredReference", value: structuredReference.value });
      index += structuredReference.length;
      continue;
    }
    if (/[()+\-*/^,;:%]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    const comparison = /^(?:<>|<=|>=|=|<|>|&)/.exec(source.slice(index));
    if (comparison) {
      tokens.push({ type: "operator", value: comparison[0] });
      index += comparison[0].length;
      continue;
    }
    if (char === '"') {
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        if (source[index] === '"') break;
        value += source[index];
        index += 1;
      }
      if (source[index] !== '"') throw new Error("Unterminated formula string");
      tokens.push({ type: "string", value });
      index += 1;
      continue;
    }
    const error = /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)/i.exec(
      source.slice(index),
    );
    if (error) {
      tokens.push({ type: "error", value: error[0].toUpperCase() });
      index += error[0].length;
      continue;
    }
    const quotedSheetReference =
      /^'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?\d+/.exec(source.slice(index));
    if (quotedSheetReference) {
      tokens.push({ type: "identifier", value: quotedSheetReference[0] });
      index += quotedSheetReference[0].length;
      continue;
    }
    const identifier = /^\$?[A-Za-z_][A-Za-z0-9_.$!]*/.exec(source.slice(index));
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    throw new Error("Invalid formula token");
  }
  return tokens;
}

function nextSpreadsheetFormulaStructuredReferenceToken(source: string) {
  const tableName = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source)?.[0] ?? "";
  const bracketStart = tableName ? tableName.length : 0;
  if (source[bracketStart] !== "[") return null;
  let depth = 0;
  for (let index = bracketStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        const length = index + 1;
        return {
          length,
          value: source.slice(0, length),
        };
      }
    }
  }
  return null;
}

function adjustSpreadsheetFormulaReferenceToken(
  reference: string,
  rowOffset: number,
  columnOffset: number,
) {
  const separator = reference.lastIndexOf("!");
  const prefix = separator >= 0 ? reference.slice(0, separator + 1) : "";
  const body = separator >= 0 ? reference.slice(separator + 1) : reference;
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(body);
  if (!match) return reference;
  const [, columnLock, column, rowLock, row] = match;
  const nextColumnIndex = columnLock
    ? columnIndexFromName(column)
    : Math.max(0, columnIndexFromName(column) + columnOffset);
  const nextRow = rowLock
    ? Number(row)
    : Math.max(1, Number(row) + rowOffset);
  return `${prefix}${columnLock}${columnName(nextColumnIndex)}${rowLock}${nextRow}`;
}

function spreadsheetFormulaReferenceInsideStructuredReference(
  source: string,
  offset: number,
) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < offset; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (inString && source[index + 1] === '"') {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function spreadsheetFormulaReferenceInsideIdentifier(
  source: string,
  offset: number,
  length: number,
) {
  const before = source[offset - 1] ?? "";
  const after = source[offset + length] ?? "";
  return /[A-Za-z0-9_.$]/.test(before) || /[A-Za-z0-9_.$[]/.test(after);
}

function spreadsheetFormulaUsesDecimalComma(source: string) {
  return (
    /\d,\d/.test(source) &&
    (source.includes(";") || !/[A-Za-z_][A-Za-z0-9_.$!]*\s*\(/.test(source))
  );
}

function nextSpreadsheetFormulaNumberToken(source: string, decimalComma: boolean) {
  const pattern = decimalComma
    ? /^(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/
    : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
  const match = pattern.exec(source);
  if (!match) return null;
  return {
    length: match[0].length,
    value: decimalComma ? match[0].replace(",", ".") : match[0],
  };
}

function spreadsheetFormulaRangeReferences(startRef: string, endRef: string) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return [];
  const prefix = formulaReferenceSheetPrefix(startRef) ?? formulaReferenceSheetPrefix(endRef) ?? "";
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const references: string[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      references.push(`${prefix}${columnName(column)}${row + 1}`);
    }
  }
  return references;
}

function spreadsheetFormulaRangeDimensions(startRef: string, endRef: string) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return null;
  return {
    width: Math.abs(end.column - start.column) + 1,
    height: Math.abs(end.row - start.row) + 1,
  };
}

function spreadsheetFormulaReferencePosition(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(normalizeSpreadsheetFormulaRef(reference));
  if (!match) return null;
  return {
    row: Math.max(0, Number(match[2]) - 1),
    column: columnIndexFromName(match[1]),
  };
}

function normalizeSpreadsheetFormulaRef(reference: string) {
  return formulaReferenceBody(reference).replace(/\$/g, "").toUpperCase();
}

function displaySpreadsheetFormulaRef(reference: string) {
  return `${formulaReferenceSheetPrefix(reference) ?? ""}${normalizeSpreadsheetFormulaRef(reference)}`;
}

function isSpreadsheetFormulaCellReference(value: string) {
  return /^[A-Z]+\d+$/i.test(normalizeSpreadsheetFormulaRef(value));
}

function formulaReferenceSheetPrefix(reference: string) {
  const separator = reference.lastIndexOf("!");
  if (separator < 0) return null;
  return reference.slice(0, separator + 1);
}

function formulaReferenceBody(reference: string) {
  return reference.slice(reference.lastIndexOf("!") + 1);
}

function columnIndexFromName(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function compareSpreadsheetFormulaRefs(left: string, right: string) {
  const leftPosition = spreadsheetFormulaReferencePosition(left);
  const rightPosition = spreadsheetFormulaReferencePosition(right);
  if (!leftPosition || !rightPosition) return left.localeCompare(right);
  return (
    leftPosition.row - rightPosition.row ||
    leftPosition.column - rightPosition.column
  );
}

function excelSerialFromDate(date: Date) {
  return excelSerialFromDateParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
}

function excelSerialFromDateTime(date: Date) {
  const dateSerial = excelSerialFromDate(date);
  const seconds =
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1000;
  return dateSerial + seconds / 86400;
}

function excelSerialFromDateParts(year: number, month: number, day: number) {
  const date = Date.UTC(year, month - 1, day);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((date - epoch) / 86400000);
}

function excelDateFromSerial(serial: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86400000);
}

function roundSpreadsheetFormulaNumber(
  value: number,
  places: number,
  direction: "away" | "toward",
) {
  const multiplier = 10 ** places;
  const scaled = value * multiplier;
  const rounded =
    direction === "away"
      ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
      : Math.sign(scaled) * Math.floor(Math.abs(scaled));
  return rounded / multiplier;
}

function roundSpreadsheetFormulaMultiple(
  value: number,
  significance: number,
  direction: "up" | "down",
) {
  const multiple = Math.abs(significance || 1);
  const scaled = value / multiple;
  return (
    (direction === "up" ? Math.ceil(scaled) : Math.floor(scaled)) * multiple
  );
}

function roundSpreadsheetFormulaOddEven(value: number, parity: "odd" | "even") {
  if (value === 0 && parity === "odd") return 1;
  const sign = value < 0 ? -1 : 1;
  let integer = Math.ceil(Math.abs(value));
  if (parity === "odd" && integer % 2 === 0) integer += 1;
  if (parity === "even" && integer % 2 !== 0) integer += 1;
  return sign * integer;
}

function spreadsheetFormulaVariance(numbers: number[], sample: boolean) {
  const values = numbers.filter(Number.isFinite);
  const denominator = sample ? values.length - 1 : values.length;
  if (denominator <= 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / denominator;
}

function spreadsheetFormulaStandardDeviation(numbers: number[], sample: boolean) {
  return Math.sqrt(spreadsheetFormulaVariance(numbers, sample));
}

function spreadsheetFormulaNthSorted(
  numbers: number[],
  rank: number,
  direction: "asc" | "desc",
) {
  const values = numbers.filter(Number.isFinite).sort((left, right) =>
    direction === "asc" ? left - right : right - left,
  );
  if (rank < 1 || rank > values.length) return "#NUM!";
  return values[rank - 1] ?? "#NUM!";
}

function spreadsheetFormulaPercentile(numbers: number[], percentile: number) {
  const values = numbers.filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length === 0 || percentile < 0 || percentile > 1) return "#NUM!";
  if (values.length === 1) return values[0] ?? 0;
  const position = (values.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return (values[lower] ?? 0) * (1 - weight) + (values[upper] ?? 0) * weight;
}

function spreadsheetFormulaNumberValue(
  text: string,
  decimalSeparator: string,
  groupSeparator: string,
) {
  const decimal = decimalSeparator || ".";
  const group = groupSeparator || ",";
  const normalized = text
    .split(group)
    .join("")
    .replace(decimal, ".")
    .replace(/\s+/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : "#VALUE!";
}

function spreadsheetFormulaTextAroundDelimiter(
  text: string,
  delimiter: string,
  side: "before" | "after",
) {
  if (!delimiter) return "#VALUE!";
  const index = text.indexOf(delimiter);
  if (index < 0) return "#N/A";
  return side === "before"
    ? text.slice(0, index)
    : text.slice(index + delimiter.length);
}

function excelSerialFromDateText(text: string) {
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return "#VALUE!";
  const date = new Date(timestamp);
  return excelSerialFromDateParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function spreadsheetFormulaWeekday(serial: number, returnType: number) {
  const day = excelDateFromSerial(serial).getUTCDay();
  const type = Math.trunc(returnType || 1);
  if (type === 2) return day === 0 ? 7 : day;
  if (type === 3) return day === 0 ? 6 : day - 1;
  return day + 1;
}

function excelSerialEndOfMonth(startSerial: number, months: number) {
  const date = excelDateFromSerial(startSerial);
  const end = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + Math.trunc(months) + 1,
      0,
    ),
  );
  return excelSerialFromDateParts(
    end.getUTCFullYear(),
    end.getUTCMonth() + 1,
    end.getUTCDate(),
  );
}

function spreadsheetFormulaIndex(
  arrayValue: SpreadsheetFormulaValue | undefined,
  row: number,
  column: number,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array || row < 1 || column < 1) return "#REF!";
  const index = (row - 1) * array.width + (column - 1);
  return array.values[index] ?? "#REF!";
}

function spreadsheetFormulaMatch(
  lookupValue: SpreadsheetFormulaValue,
  arrayValue: SpreadsheetFormulaValue | undefined,
  matchType: number,
) {
  const values = spreadsheetFormulaAsArray(arrayValue)?.values ?? [];
  if (values.length === 0) return "#N/A";
  if (matchType === 0) {
    const index = values.findIndex((value) =>
      spreadsheetFormulaValuesEqual(value, lookupValue),
    );
    return index < 0 ? "#N/A" : index + 1;
  }
  const lookupNumber = spreadsheetFormulaValueNumber(lookupValue);
  let bestIndex = -1;
  values.forEach((value, index) => {
    const number = spreadsheetFormulaValueNumber(value);
    if (
      (matchType > 0 && number <= lookupNumber) ||
      (matchType < 0 && number >= lookupNumber)
    ) {
      bestIndex = index;
    }
  });
  return bestIndex < 0 ? "#N/A" : bestIndex + 1;
}

function spreadsheetFormulaXMatch(
  lookupValue: SpreadsheetFormulaValue,
  arrayValue: SpreadsheetFormulaValue | undefined,
  matchMode: number,
  searchMode: number,
) {
  const values = spreadsheetFormulaAsArray(arrayValue)?.values ?? [];
  const indexes = values.map((_, index) => index);
  if (searchMode === -1) indexes.reverse();
  const exact = indexes.find((index) =>
    spreadsheetFormulaValuesEqual(values[index] ?? "", lookupValue),
  );
  if (exact !== undefined) return exact + 1;
  if (matchMode === 2) {
    const pattern = wildcardSpreadsheetFormulaPattern(spreadsheetFormulaValueText(lookupValue));
    const wildcard = indexes.find((index) =>
      pattern.test(spreadsheetFormulaValueText(values[index] ?? "")),
    );
    if (wildcard !== undefined) return wildcard + 1;
  }
  if (matchMode === -1 || matchMode === 1) {
    return spreadsheetFormulaMatch(lookupValue, arrayValue, matchMode);
  }
  return "#N/A";
}

function spreadsheetFormulaXLookup(
  lookupValue: SpreadsheetFormulaValue,
  lookupArrayValue: SpreadsheetFormulaValue | undefined,
  returnArrayValue: SpreadsheetFormulaValue | undefined,
  fallback: SpreadsheetFormulaValue | undefined,
  matchMode: number,
  searchMode: number,
) {
  const lookupArray = spreadsheetFormulaAsArray(lookupArrayValue);
  const returnArray = spreadsheetFormulaAsArray(returnArrayValue);
  if (!lookupArray || !returnArray) return fallback ?? "#N/A";
  const position = spreadsheetFormulaXMatch(
    lookupValue,
    lookupArray,
    matchMode,
    searchMode,
  );
  if (typeof position !== "number") return fallback ?? position;
  return returnArray.values[position - 1] ?? fallback ?? "#N/A";
}

function spreadsheetFormulaTableLookup(
  lookupValue: SpreadsheetFormulaValue,
  tableValue: SpreadsheetFormulaValue | undefined,
  resultIndex: number,
  approximate: boolean,
  direction: "vertical" | "horizontal",
) {
  const table = spreadsheetFormulaAsArray(tableValue);
  if (!table || resultIndex < 1) return "#N/A";
  if (direction === "vertical") {
    const lookupColumn = Array.from({ length: table.height }, (_, row) =>
      table.values[row * table.width] ?? "",
    );
    const position = spreadsheetFormulaMatch(
      lookupValue,
      spreadsheetFormulaArray(lookupColumn, 1, lookupColumn.length),
      approximate ? 1 : 0,
    );
    if (typeof position !== "number") return position;
    return table.values[(position - 1) * table.width + resultIndex - 1] ?? "#REF!";
  }
  const lookupRow = table.values.slice(0, table.width);
  const position = spreadsheetFormulaMatch(
    lookupValue,
    spreadsheetFormulaArray(lookupRow, lookupRow.length, 1),
    approximate ? 1 : 0,
  );
  if (typeof position !== "number") return position;
  return table.values[(resultIndex - 1) * table.width + position - 1] ?? "#REF!";
}

function spreadsheetFormulaFilter(
  arrayValue: SpreadsheetFormulaValue | undefined,
  includeValue: SpreadsheetFormulaValue | undefined,
  fallback: SpreadsheetFormulaValue | undefined,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  const include = spreadsheetFormulaAsArray(includeValue);
  if (!array || !include) return fallback ?? "#CALC!";
  const values = array.values.filter((_, index) =>
    spreadsheetFormulaValueBoolean(include.values[index] ?? false),
  );
  return values.length > 0
    ? spreadsheetFormulaArray(values, Math.min(array.width, values.length), Math.ceil(values.length / Math.max(array.width, 1)))
    : (fallback ?? "#CALC!");
}

function spreadsheetFormulaUnique(arrayValue: SpreadsheetFormulaValue | undefined) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array) return "#CALC!";
  const seen = new Set<string>();
  const values = array.values.filter((value) => {
    const key = spreadsheetFormulaValueText(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return spreadsheetFormulaArray(values, Math.min(array.width, values.length), Math.ceil(values.length / Math.max(array.width, 1)));
}

function spreadsheetFormulaSort(
  arrayValue: SpreadsheetFormulaValue | undefined,
  sortIndex: number,
  sortOrder: number,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array || array.width === 0) return "#CALC!";
  const targetColumn = Math.max(0, Math.min(array.width - 1, sortIndex - 1));
  const rows = Array.from({ length: array.height }, (_, rowIndex) =>
    array.values.slice(rowIndex * array.width, rowIndex * array.width + array.width),
  );
  rows.sort((left, right) => {
    const comparison = compareSpreadsheetFormulaValues(
      left[targetColumn] ?? "",
      right[targetColumn] ?? "",
      "<",
    );
    if (comparison === true) return sortOrder < 0 ? 1 : -1;
    const reverseComparison = compareSpreadsheetFormulaValues(
      left[targetColumn] ?? "",
      right[targetColumn] ?? "",
      ">",
    );
    if (reverseComparison === true) return sortOrder < 0 ? -1 : 1;
    return 0;
  });
  return spreadsheetFormulaArray(rows.flat(), array.width, rows.length);
}

function substituteSpreadsheetFormulaText(
  text: string,
  oldText: string,
  newText: string,
  instance: number | undefined,
) {
  if (!oldText) return text;
  const targetInstance =
    instance === undefined ? undefined : Math.max(1, Math.trunc(instance));
  if (targetInstance === undefined) return text.split(oldText).join(newText);
  let seen = 0;
  let index = 0;
  let output = "";
  while (index < text.length) {
    if (text.startsWith(oldText, index)) {
      seen += 1;
      output += seen === targetInstance ? newText : oldText;
      index += oldText.length;
    } else {
      output += text[index];
      index += 1;
    }
  }
  return output;
}

function findSpreadsheetFormulaText(
  needle: string,
  haystack: string,
  start: number | undefined,
  insensitive: boolean,
) {
  const offset = Math.max(0, Math.trunc(start ?? 1) - 1);
  const searchNeedle = insensitive ? needle.toLowerCase() : needle;
  const searchHaystack = insensitive ? haystack.toLowerCase() : haystack;
  const index = searchHaystack.indexOf(searchNeedle, offset);
  return index < 0 ? 0 : index + 1;
}
