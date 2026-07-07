import { columnName } from "./models";

export type SpreadsheetFormulaValue = number | string | boolean;

type SpreadsheetFormulaToken =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string };

export function evaluateSpreadsheetFormula(
  formula: string,
  valueForRef: (reference: string) => string,
) {
  return new SpreadsheetFormulaParser(formula, valueForRef).parse();
}

export function adjustSpreadsheetFormulaReferences(
  formula: string,
  rowOffset: number,
  columnOffset: number,
) {
  return formula.replace(
    /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g,
    (_match, columnLock: string, column: string, rowLock: string, row: string) => {
      const nextColumnIndex = columnLock
        ? columnIndexFromName(column)
        : Math.max(0, columnIndexFromName(column) + columnOffset);
      const nextRow = rowLock
        ? Number(row)
        : Math.max(1, Number(row) + rowOffset);
      return `${columnLock}${columnName(nextColumnIndex)}${rowLock}${nextRow}`;
    },
  );
}

export function spreadsheetFormulaValueNumber(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value ?? "");
  return Number.isFinite(number) ? number : 0;
}

export function spreadsheetFormulaValueBoolean(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && Number.isFinite(value);
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return false;
  if (normalized === "FALSE") return false;
  if (normalized === "TRUE") return true;
  const number = Number(normalized);
  return Number.isFinite(number) ? number !== 0 : true;
}

export function formatSpreadsheetFormulaResult(value: SpreadsheetFormulaValue) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(12)).toString();
}

class SpreadsheetFormulaParser {
  private readonly tokens: SpreadsheetFormulaToken[];
  private readonly valueForRef: (reference: string) => string;
  private index = 0;

  constructor(
    formula: string,
    valueForRef: (reference: string) => string,
  ) {
    this.tokens = tokenizeSpreadsheetFormula(formula);
    this.valueForRef = valueForRef;
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

  private parseAdditive(): number {
    let value = this.parseTerm();
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parsePower();
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parsePower();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parsePower(): number {
    let value = spreadsheetFormulaValueNumber(this.parseUnary());
    while (this.matchOperator("^")) {
      value = value ** spreadsheetFormulaValueNumber(this.parseUnary());
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
    return this.parsePrimary();
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
    if (token.type === "identifier") {
      if (token.value.toUpperCase() === "TRUE") return true;
      if (token.value.toUpperCase() === "FALSE") return false;
      if (this.matchOperator("(")) {
        return this.evaluateFunction(token.value);
      }
      if (isSpreadsheetFormulaCellReference(token.value)) {
        return this.valueForRef(token.value);
      }
    }
    throw new Error("Unsupported formula value");
  }

  private evaluateFunction(name: string): SpreadsheetFormulaValue {
    const args: SpreadsheetFormulaValue[] = [];
    if (!this.checkOperator(")")) {
      do {
        args.push(...this.parseFunctionArgument());
      } while (this.matchOperator(","));
    }
    this.consumeOperator(")");
    const upper = name.toUpperCase();
    const numbers = args.map(spreadsheetFormulaValueNumber);
    if (upper === "SUM") return numbers.reduce((total, value) => total + value, 0);
    if (upper === "AVERAGE") {
      return numbers.length === 0
        ? 0
        : numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    if (upper === "COUNT") {
      return args.filter(
        (value) =>
          spreadsheetFormulaValueText(value) !== "" && Number.isFinite(Number(value)),
      ).length;
    }
    if (upper === "COUNTA") {
      return args.filter((value) => spreadsheetFormulaValueText(value) !== "").length;
    }
    if (upper === "MIN") return numbers.length === 0 ? 0 : Math.min(...numbers);
    if (upper === "MAX") return numbers.length === 0 ? 0 : Math.max(...numbers);
    if (upper === "ABS") return Math.abs(numbers[0] ?? 0);
    if (upper === "ROUND") {
      const places = Math.trunc(numbers[1] ?? 0);
      const multiplier = 10 ** places;
      return Math.round((numbers[0] ?? 0) * multiplier) / multiplier;
    }
    if (upper === "POWER") return (numbers[0] ?? 0) ** (numbers[1] ?? 0);
    if (upper === "SQRT") return Math.sqrt(numbers[0] ?? 0);
    if (upper === "IF") {
      return spreadsheetFormulaValueBoolean(args[0])
        ? (args[1] ?? true)
        : (args[2] ?? false);
    }
    if (upper === "AND") return args.every(spreadsheetFormulaValueBoolean);
    if (upper === "OR") return args.some(spreadsheetFormulaValueBoolean);
    if (upper === "NOT") return !spreadsheetFormulaValueBoolean(args[0]);
    if (upper === "LEN") return spreadsheetFormulaValueText(args[0]).length;
    if (upper === "CONCAT" || upper === "CONCATENATE") {
      return args.map(spreadsheetFormulaValueText).join("");
    }
    if (upper === "LEFT") {
      return spreadsheetFormulaValueText(args[0]).slice(
        0,
        Math.max(0, Math.trunc(numbers[1] ?? 1)),
      );
    }
    if (upper === "RIGHT") {
      const text = spreadsheetFormulaValueText(args[0]);
      return text.slice(Math.max(0, text.length - Math.trunc(numbers[1] ?? 1)));
    }
    if (upper === "MID") {
      const text = spreadsheetFormulaValueText(args[0]);
      const start = Math.max(0, Math.trunc(numbers[1] ?? 1) - 1);
      return text.slice(start, start + Math.max(0, Math.trunc(numbers[2] ?? 1)));
    }
    if (upper === "LOWER") {
      return spreadsheetFormulaValueText(args[0]).toLowerCase();
    }
    if (upper === "UPPER") {
      return spreadsheetFormulaValueText(args[0]).toUpperCase();
    }
    if (upper === "TRIM") {
      return spreadsheetFormulaValueText(args[0]).trim().replace(/\s+/g, " ");
    }
    if (upper === "TODAY") return excelSerialFromDate(new Date());
    if (upper === "NOW") return excelSerialFromDateTime(new Date());
    if (upper === "DATE") {
      return excelSerialFromDateParts(
        Math.trunc(numbers[0] ?? 1900),
        Math.trunc(numbers[1] ?? 1),
        Math.trunc(numbers[2] ?? 1),
      );
    }
    throw new Error("Unsupported formula function");
  }

  private parseFunctionArgument(): SpreadsheetFormulaValue[] {
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
      return spreadsheetFormulaRangeReferences(start.value, end.value).map(
        (reference) => this.valueForRef(reference),
      );
    }
    return [this.parseExpression()];
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
  const tokens: SpreadsheetFormulaToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[()+\-*/^,:]/.test(char)) {
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
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(index));
    if (number) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
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

function spreadsheetFormulaRangeReferences(startRef: string, endRef: string) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return [];
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const references: string[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      references.push(`${columnName(column)}${row + 1}`);
    }
  }
  return references;
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
  return reference
    .slice(reference.lastIndexOf("!") + 1)
    .replace(/\$/g, "")
    .toUpperCase();
}

function isSpreadsheetFormulaCellReference(value: string) {
  return /^[A-Z]+\d+$/i.test(normalizeSpreadsheetFormulaRef(value));
}

function columnIndexFromName(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function spreadsheetFormulaValueText(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function compareSpreadsheetFormulaValues(
  left: SpreadsheetFormulaValue,
  right: SpreadsheetFormulaValue,
  operator: string,
) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const comparable =
    Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : spreadsheetFormulaValueText(left).localeCompare(
          spreadsheetFormulaValueText(right),
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          },
        );
  if (operator === "=") return comparable === 0;
  if (operator === "<>") return comparable !== 0;
  if (operator === "<") return comparable < 0;
  if (operator === "<=") return comparable <= 0;
  if (operator === ">") return comparable > 0;
  if (operator === ">=") return comparable >= 0;
  return false;
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
