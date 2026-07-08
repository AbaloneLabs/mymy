import type { SpreadsheetFormulaEvaluator } from "./spreadsheetFormulaTypes";
import {
  spreadsheetFormulaFlattenValues,
  spreadsheetFormulaValueNumber,
} from "./spreadsheetFormulaValues";

export function spreadsheetFormulaNpv(rate: number, values: number[]) {
  if (rate <= -1) return "#NUM!";
  return values.reduce(
    (total, value, index) => total + value / ((1 + rate) ** (index + 1)),
    0,
  );
}

export function spreadsheetFormulaIrr(values: number[], guess: number) {
  if (
    values.length < 2 ||
    !values.some((value) => value > 0) ||
    !values.some((value) => value < 0)
  ) {
    return "#NUM!";
  }
  const initialGuess = Number.isFinite(guess) && guess > -1 ? guess : 0.1;
  const newton = spreadsheetFormulaIrrByNewton(values, initialGuess);
  return typeof newton === "number" ? newton : spreadsheetFormulaIrrByBisection(values);
}

function spreadsheetFormulaIrrByNewton(values: number[], guess: number) {
  let rate = guess;
  for (let index = 0; index < 100; index += 1) {
    const value = spreadsheetFormulaIrrNpv(values, rate);
    const derivative = values.reduce(
      (total, cashFlow, period) =>
        period === 0
          ? total
          : total - (period * cashFlow) / ((1 + rate) ** (period + 1)),
      0,
    );
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || derivative === 0) {
      return "#NUM!";
    }
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -1) return "#NUM!";
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }
  return "#NUM!";
}

function spreadsheetFormulaIrrByBisection(values: number[]) {
  let previousRate = -0.999999;
  let previousValue = spreadsheetFormulaIrrNpv(values, previousRate);
  for (let step = 1; step <= 600; step += 1) {
    const rate = -0.999999 + (100.999999 * step) / 600;
    const value = spreadsheetFormulaIrrNpv(values, rate);
    if (Math.abs(value) < 1e-8) return rate;
    if (Number.isFinite(value) && Math.sign(value) !== Math.sign(previousValue)) {
      return spreadsheetFormulaBisectIrr(values, previousRate, rate);
    }
    previousRate = rate;
    previousValue = value;
  }
  return "#NUM!";
}

function spreadsheetFormulaBisectIrr(values: number[], low: number, high: number) {
  let left = low;
  let right = high;
  let leftValue = spreadsheetFormulaIrrNpv(values, left);
  for (let index = 0; index < 120; index += 1) {
    const middle = (left + right) / 2;
    const middleValue = spreadsheetFormulaIrrNpv(values, middle);
    if (Math.abs(middleValue) < 1e-8 || Math.abs(right - left) < 1e-10) {
      return middle;
    }
    if (Math.sign(middleValue) === Math.sign(leftValue)) {
      left = middle;
      leftValue = middleValue;
    } else {
      right = middle;
    }
  }
  return (left + right) / 2;
}

function spreadsheetFormulaIrrNpv(values: number[], rate: number) {
  return values.reduce(
    (total, value, index) => total + value / ((1 + rate) ** index),
    0,
  );
}

export function spreadsheetFormulaMirr(
  values: number[],
  financeRate: number,
  reinvestRate: number,
) {
  const positive = values.filter((value) => value > 0);
  const negative = values.filter((value) => value < 0);
  if (
    values.length < 2 ||
    positive.length === 0 ||
    negative.length === 0 ||
    financeRate <= -1 ||
    reinvestRate <= -1
  ) {
    return "#NUM!";
  }
  const periods = values.length - 1;
  const reinvestedPositive = values.reduce(
    (total, value, index) =>
      value > 0
        ? total + value * ((1 + reinvestRate) ** (periods - index))
        : total,
    0,
  );
  const financedNegative = values.reduce(
    (total, value, index) =>
      value < 0 ? total + value / ((1 + financeRate) ** index) : total,
    0,
  );
  if (financedNegative === 0) return "#NUM!";
  return ((-reinvestedPositive / financedNegative) ** (1 / periods)) - 1;
}

export function spreadsheetFormulaCashFlowSeries(
  args: Parameters<SpreadsheetFormulaEvaluator>[0],
  numbers: number[],
  trailingParameters: number,
) {
  if (args[0] && typeof args[0] === "object" && "kind" in args[0]) {
    return spreadsheetFormulaFlattenValues([args[0]]).map(spreadsheetFormulaValueNumber);
  }
  return trailingParameters > 0 ? numbers.slice(0, -trailingParameters) : numbers;
}
