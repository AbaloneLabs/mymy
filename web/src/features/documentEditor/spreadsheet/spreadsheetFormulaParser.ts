import {
  SPREADSHEET_FORMULA_ERROR_HANDLERS,
  SPREADSHEET_FORMULA_EVALUATORS,
} from "./spreadsheetFormulaEvaluators";
import {
  spreadsheetFormulaRangeDimensions,
  spreadsheetFormulaRangeReferences,
  isSpreadsheetFormulaCellReference,
} from "./spreadsheetFormulaReferences";
import { tokenizeSpreadsheetFormula } from "./spreadsheetFormulaTokens";
import type { SpreadsheetFormulaToken } from "./spreadsheetFormulaTokens";
import {
  compareSpreadsheetFormulaValues,
  spreadsheetFormulaArray,
  spreadsheetFormulaFirstError,
  spreadsheetFormulaFlattenValues,
  spreadsheetFormulaValueNumber,
  spreadsheetFormulaValueText,
} from "./spreadsheetFormulaValues";
import type { SpreadsheetFormulaValue } from "./spreadsheetFormulaValues";
import type { SpreadsheetFormulaEvaluationContext } from "./spreadsheetFormulaTypes";

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
