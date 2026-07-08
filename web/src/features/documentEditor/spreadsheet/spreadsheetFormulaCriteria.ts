import {
  compareSpreadsheetFormulaValues,
  spreadsheetFormulaAsArray,
  spreadsheetFormulaValueNumber,
  spreadsheetFormulaValueText,
  wildcardSpreadsheetFormulaPattern,
} from "./spreadsheetFormulaValues";
import type {
  SpreadsheetFormulaScalar,
  SpreadsheetFormulaValue,
} from "./spreadsheetFormulaValues";

type SpreadsheetFormulaCriteriaPair = {
  values: SpreadsheetFormulaScalar[];
  matcher: (value: SpreadsheetFormulaScalar) => boolean;
};

export function spreadsheetFormulaCountIf(
  rangeValue: SpreadsheetFormulaValue | undefined,
  criteria: SpreadsheetFormulaValue | undefined,
) {
  const matcher = spreadsheetFormulaCriteriaMatcher(criteria);
  return (spreadsheetFormulaAsArray(rangeValue)?.values ?? []).filter(matcher).length;
}

export function spreadsheetFormulaCountIfs(args: SpreadsheetFormulaValue[]) {
  const pairs = spreadsheetFormulaCriteriaPairs(args);
  if (pairs.length === 0) return 0;
  const rowCount = Math.max(...pairs.map((pair) => pair.values.length), 0);
  let count = 0;
  for (let index = 0; index < rowCount; index += 1) {
    if (spreadsheetFormulaCriteriaPairsMatch(pairs, index)) count += 1;
  }
  return count;
}

export function spreadsheetFormulaSumIf(
  rangeValue: SpreadsheetFormulaValue | undefined,
  criteria: SpreadsheetFormulaValue | undefined,
  sumRangeValue: SpreadsheetFormulaValue | undefined,
) {
  const criteriaValues = spreadsheetFormulaAsArray(rangeValue)?.values ?? [];
  const sumValues = spreadsheetFormulaAsArray(sumRangeValue ?? rangeValue)?.values ?? [];
  const matcher = spreadsheetFormulaCriteriaMatcher(criteria);
  return criteriaValues.reduce<number>(
    (total, value, index) =>
      matcher(value)
        ? total + spreadsheetFormulaValueNumber(sumValues[index] ?? "")
        : total,
    0,
  );
}

export function spreadsheetFormulaSumIfs(
  sumRangeValue: SpreadsheetFormulaValue | undefined,
  criteriaArgs: SpreadsheetFormulaValue[],
) {
  const sumValues = spreadsheetFormulaAsArray(sumRangeValue)?.values ?? [];
  const pairs = spreadsheetFormulaCriteriaPairs(criteriaArgs);
  return sumValues.reduce<number>(
    (total, value, index) =>
      spreadsheetFormulaCriteriaPairsMatch(pairs, index)
        ? total + spreadsheetFormulaValueNumber(value)
        : total,
    0,
  );
}

export function spreadsheetFormulaAverageIf(
  rangeValue: SpreadsheetFormulaValue | undefined,
  criteria: SpreadsheetFormulaValue | undefined,
  averageRangeValue: SpreadsheetFormulaValue | undefined,
) {
  const criteriaValues = spreadsheetFormulaAsArray(rangeValue)?.values ?? [];
  const averageValues =
    spreadsheetFormulaAsArray(averageRangeValue ?? rangeValue)?.values ?? [];
  const matcher = spreadsheetFormulaCriteriaMatcher(criteria);
  const values = criteriaValues
    .map((value, index) =>
      matcher(value)
        ? spreadsheetFormulaValueNumber(averageValues[index] ?? "")
        : null,
    )
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0
    ? "#DIV/0!"
    : values.reduce<number>((total, value) => total + value, 0) / values.length;
}

export function spreadsheetFormulaAverageIfs(
  averageRangeValue: SpreadsheetFormulaValue | undefined,
  criteriaArgs: SpreadsheetFormulaValue[],
) {
  const averageValues = spreadsheetFormulaAsArray(averageRangeValue)?.values ?? [];
  const pairs = spreadsheetFormulaCriteriaPairs(criteriaArgs);
  const values = averageValues.filter((_value, index) =>
    spreadsheetFormulaCriteriaPairsMatch(pairs, index),
  );
  return values.length === 0
    ? "#DIV/0!"
    : values.reduce<number>(
        (total, value) => total + spreadsheetFormulaValueNumber(value),
        0,
      ) / values.length;
}

function spreadsheetFormulaCriteriaPairs(args: SpreadsheetFormulaValue[]) {
  const pairs: SpreadsheetFormulaCriteriaPair[] = [];
  for (let index = 0; index + 1 < args.length; index += 2) {
    pairs.push({
      values: spreadsheetFormulaAsArray(args[index])?.values ?? [],
      matcher: spreadsheetFormulaCriteriaMatcher(args[index + 1]),
    });
  }
  return pairs;
}

function spreadsheetFormulaCriteriaPairsMatch(
  pairs: SpreadsheetFormulaCriteriaPair[],
  index: number,
) {
  return pairs.every((pair) => pair.matcher(pair.values[index] ?? ""));
}

function spreadsheetFormulaCriteriaMatcher(
  criteria: SpreadsheetFormulaValue | undefined,
) {
  const text = spreadsheetFormulaValueText(criteria);
  const match = /^(>=|<=|<>|=|>|<)(.*)$/.exec(text);
  const operator = match?.[1] ?? "=";
  const operand = match?.[2] ?? text;
  const wildcard = /[*?]/.test(operand)
    ? wildcardSpreadsheetFormulaPattern(operand)
    : null;
  return (value: SpreadsheetFormulaScalar) => {
    if (operator === "=" || operator === "<>") {
      const matched = wildcard
        ? wildcard.test(spreadsheetFormulaValueText(value))
        : compareSpreadsheetFormulaValues(value, operand, "=") === true;
      return operator === "<>" ? !matched : matched;
    }
    return compareSpreadsheetFormulaValues(value, operand, operator) === true;
  };
}
