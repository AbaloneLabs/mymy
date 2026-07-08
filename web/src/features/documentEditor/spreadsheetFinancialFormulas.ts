import type { SpreadsheetFormulaEvaluator } from "./spreadsheetFormula";
import {
  spreadsheetFormulaFlattenValues,
  spreadsheetFormulaValueNumber,
} from "./spreadsheetFormulaValues";

export const SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS: Record<
  string,
  SpreadsheetFormulaEvaluator
> = {
  PV: (_args, numbers) =>
    spreadsheetFormulaPv(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  FV: (_args, numbers) =>
    spreadsheetFormulaFv(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  NPER: (_args, numbers) =>
    spreadsheetFormulaNper(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  RATE: (_args, numbers) =>
    spreadsheetFormulaRate(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0.1,
    ),
  NPV: (_args, numbers) => spreadsheetFormulaNpv(numbers[0] ?? 0, numbers.slice(1)),
  IRR: (args, numbers) =>
    spreadsheetFormulaIrr(
      spreadsheetFormulaCashFlowSeries(args, numbers, 0),
      spreadsheetFormulaValueNumber(args[1] ?? 0.1),
    ),
  MIRR: (args, numbers) => {
    const series = spreadsheetFormulaCashFlowSeries(args, numbers, 2);
    const financeRate =
      args.length > 1
        ? spreadsheetFormulaValueNumber(args[1])
        : (numbers.at(-2) ?? 0);
    const reinvestRate =
      args.length > 2
        ? spreadsheetFormulaValueNumber(args[2])
        : (numbers.at(-1) ?? 0);
    return spreadsheetFormulaMirr(series, financeRate, reinvestRate);
  },
  PMT: (_args, numbers) =>
    spreadsheetFormulaPmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
    ),
  IPMT: (_args, numbers) =>
    spreadsheetFormulaIpmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
    ),
  PPMT: (_args, numbers) =>
    spreadsheetFormulaPpmt(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
    ),
  CUMIPMT: (_args, numbers) =>
    spreadsheetFormulaCumulativePayment(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
      "interest",
    ),
  CUMPRINC: (_args, numbers) =>
    spreadsheetFormulaCumulativePayment(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 0,
      numbers[5] ?? 0,
      "principal",
    ),
  SLN: (_args, numbers) =>
    spreadsheetFormulaStraightLineDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
    ),
  SYD: (_args, numbers) =>
    spreadsheetFormulaSumOfYearsDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
    ),
  DB: (_args, numbers) =>
    spreadsheetFormulaFixedDecliningDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 12,
    ),
  DDB: (_args, numbers) =>
    spreadsheetFormulaDoubleDecliningDepreciation(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
      numbers[3] ?? 0,
      numbers[4] ?? 2,
    ),
  EFFECT: (_args, numbers) =>
    spreadsheetFormulaEffectiveRate(numbers[0] ?? 0, numbers[1] ?? 0),
  NOMINAL: (_args, numbers) =>
    spreadsheetFormulaNominalRate(numbers[0] ?? 0, numbers[1] ?? 0),
  RRI: (_args, numbers) =>
    spreadsheetFormulaEquivalentRate(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      numbers[2] ?? 0,
    ),
};

function spreadsheetFormulaPmt(
  rate: number,
  periods: number,
  presentValue: number,
  futureValue: number,
  dueType: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  if (paymentDue === null) return "#NUM!";
  if (periods === 0) return "#NUM!";
  if (rate === 0) return -(presentValue + futureValue) / periods;
  const factor = (1 + rate) ** periods;
  return (
    -(rate * (futureValue + factor * presentValue)) /
    ((1 + rate * paymentDue) * (factor - 1))
  );
}

function spreadsheetFormulaPv(
  rate: number,
  periods: number,
  payment: number,
  futureValue: number,
  dueType: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  if (paymentDue === null || periods < 0 || rate <= -1) return "#NUM!";
  if (rate === 0) return -(futureValue + payment * periods);
  const factor = (1 + rate) ** periods;
  return (
    -(futureValue + payment * (1 + rate * paymentDue) * ((factor - 1) / rate)) /
    factor
  );
}

function spreadsheetFormulaFv(
  rate: number,
  periods: number,
  payment: number,
  presentValue: number,
  dueType: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  if (paymentDue === null || periods < 0 || rate <= -1) return "#NUM!";
  if (rate === 0) return -(presentValue + payment * periods);
  const factor = (1 + rate) ** periods;
  return -(
    presentValue * factor +
    payment * (1 + rate * paymentDue) * ((factor - 1) / rate)
  );
}

function spreadsheetFormulaNper(
  rate: number,
  payment: number,
  presentValue: number,
  futureValue: number,
  dueType: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  if (paymentDue === null || rate <= -1) return "#NUM!";
  if (rate === 0) {
    if (payment === 0) return "#NUM!";
    return -(presentValue + futureValue) / payment;
  }
  const paymentFactor = payment * (1 + rate * paymentDue) / rate;
  const numerator = paymentFactor - futureValue;
  const denominator = paymentFactor + presentValue;
  if (denominator === 0 || numerator / denominator <= 0) return "#NUM!";
  return Math.log(numerator / denominator) / Math.log(1 + rate);
}

function spreadsheetFormulaRate(
  periods: number,
  payment: number,
  presentValue: number,
  futureValue: number,
  dueType: number,
  guess: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  if (paymentDue === null || periods <= 0) return "#NUM!";
  let rate = Number.isFinite(guess) && guess > -1 ? guess : 0.1;
  for (let index = 0; index < 80; index += 1) {
    const value = spreadsheetFormulaRateEquation(
      rate,
      periods,
      payment,
      presentValue,
      futureValue,
      paymentDue,
    );
    const delta = Math.max(Math.abs(rate), 1) * 1e-6;
    const derivative =
      (spreadsheetFormulaRateEquation(
        rate + delta,
        periods,
        payment,
        presentValue,
        futureValue,
        paymentDue,
      ) -
        spreadsheetFormulaRateEquation(
          rate - delta,
          periods,
          payment,
          presentValue,
          futureValue,
          paymentDue,
        )) /
      (delta * 2);
    if (!Number.isFinite(value) || !Number.isFinite(derivative) || derivative === 0) {
      break;
    }
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }
  return spreadsheetFormulaRateByBisection(
    periods,
    payment,
    presentValue,
    futureValue,
    paymentDue,
  );
}

function spreadsheetFormulaRateEquation(
  rate: number,
  periods: number,
  payment: number,
  presentValue: number,
  futureValue: number,
  dueType: 0 | 1,
) {
  if (Math.abs(rate) < 1e-8) {
    return presentValue + payment * periods + futureValue;
  }
  const factor = (1 + rate) ** periods;
  return (
    presentValue * factor +
    payment * (1 + rate * dueType) * ((factor - 1) / rate) +
    futureValue
  );
}

function spreadsheetFormulaRateByBisection(
  periods: number,
  payment: number,
  presentValue: number,
  futureValue: number,
  dueType: 0 | 1,
) {
  let previousRate = -0.999999;
  let previousValue = spreadsheetFormulaRateEquation(
    previousRate,
    periods,
    payment,
    presentValue,
    futureValue,
    dueType,
  );
  for (let step = 1; step <= 240; step += 1) {
    const rate = -0.999999 + (10.999999 * step) / 240;
    const value = spreadsheetFormulaRateEquation(
      rate,
      periods,
      payment,
      presentValue,
      futureValue,
      dueType,
    );
    if (previousValue === 0) return previousRate;
    if (Number.isFinite(value) && Math.sign(value) !== Math.sign(previousValue)) {
      return spreadsheetFormulaBisectRate(
        previousRate,
        rate,
        periods,
        payment,
        presentValue,
        futureValue,
        dueType,
      );
    }
    previousRate = rate;
    previousValue = value;
  }
  return "#NUM!";
}

function spreadsheetFormulaBisectRate(
  low: number,
  high: number,
  periods: number,
  payment: number,
  presentValue: number,
  futureValue: number,
  dueType: 0 | 1,
) {
  let left = low;
  let right = high;
  let leftValue = spreadsheetFormulaRateEquation(
    left,
    periods,
    payment,
    presentValue,
    futureValue,
    dueType,
  );
  for (let index = 0; index < 100; index += 1) {
    const middle = (left + right) / 2;
    const middleValue = spreadsheetFormulaRateEquation(
      middle,
      periods,
      payment,
      presentValue,
      futureValue,
      dueType,
    );
    if (Math.abs(middleValue) < 1e-9 || Math.abs(right - left) < 1e-10) {
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

function spreadsheetFormulaNpv(rate: number, values: number[]) {
  if (rate <= -1) return "#NUM!";
  return values.reduce(
    (total, value, index) => total + value / ((1 + rate) ** (index + 1)),
    0,
  );
}

function spreadsheetFormulaIrr(values: number[], guess: number) {
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

function spreadsheetFormulaMirr(
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

function spreadsheetFormulaIpmt(
  rate: number,
  period: number,
  periods: number,
  presentValue: number,
  futureValue: number,
  dueType: number,
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  const currentPeriod = Math.trunc(period);
  if (
    paymentDue === null ||
    rate < 0 ||
    periods <= 0 ||
    currentPeriod < 1 ||
    currentPeriod > periods
  ) {
    return "#NUM!";
  }
  const payment = spreadsheetFormulaPmt(
    rate,
    periods,
    presentValue,
    futureValue,
    paymentDue,
  );
  if (typeof payment !== "number") return payment;
  if (rate === 0) return 0;
  if (paymentDue === 1 && currentPeriod === 1) return 0;
  const balance = spreadsheetFormulaLoanBalance(
    rate,
    currentPeriod - 1,
    payment,
    presentValue,
    paymentDue,
  );
  return -(paymentDue === 1 ? balance + payment : balance) * rate;
}

function spreadsheetFormulaPpmt(
  rate: number,
  period: number,
  periods: number,
  presentValue: number,
  futureValue: number,
  dueType: number,
) {
  const payment = spreadsheetFormulaPmt(rate, periods, presentValue, futureValue, dueType);
  const interest = spreadsheetFormulaIpmt(
    rate,
    period,
    periods,
    presentValue,
    futureValue,
    dueType,
  );
  if (typeof payment !== "number") return payment;
  if (typeof interest !== "number") return interest;
  return payment - interest;
}

function spreadsheetFormulaCumulativePayment(
  rate: number,
  periods: number,
  presentValue: number,
  startPeriod: number,
  endPeriod: number,
  dueType: number,
  kind: "interest" | "principal",
) {
  const paymentDue = spreadsheetFormulaDueType(dueType);
  const start = Math.trunc(startPeriod);
  const end = Math.trunc(endPeriod);
  if (
    paymentDue === null ||
    rate <= 0 ||
    periods <= 0 ||
    presentValue <= 0 ||
    start < 1 ||
    end < start ||
    end > periods
  ) {
    return "#NUM!";
  }
  let total = 0;
  for (let period = start; period <= end; period += 1) {
    const value =
      kind === "interest"
        ? spreadsheetFormulaIpmt(rate, period, periods, presentValue, 0, paymentDue)
        : spreadsheetFormulaPpmt(rate, period, periods, presentValue, 0, paymentDue);
    if (typeof value !== "number") return value;
    total += value;
  }
  return total;
}

function spreadsheetFormulaLoanBalance(
  rate: number,
  completedPeriods: number,
  payment: number,
  presentValue: number,
  dueType: 0 | 1,
) {
  if (completedPeriods <= 0) return presentValue;
  if (rate === 0) return presentValue + payment * completedPeriods;
  const factor = (1 + rate) ** completedPeriods;
  return (
    presentValue * factor +
    payment * (1 + rate * dueType) * ((factor - 1) / rate)
  );
}

function spreadsheetFormulaStraightLineDepreciation(
  cost: number,
  salvage: number,
  life: number,
) {
  if (life <= 0) return "#NUM!";
  return (cost - salvage) / life;
}

function spreadsheetFormulaSumOfYearsDepreciation(
  cost: number,
  salvage: number,
  life: number,
  period: number,
) {
  if (life <= 0 || period <= 0 || period > life) return "#NUM!";
  return ((cost - salvage) * (life - period + 1) * 2) / (life * (life + 1));
}

function spreadsheetFormulaFixedDecliningDepreciation(
  cost: number,
  salvage: number,
  life: number,
  period: number,
  month: number,
) {
  const currentPeriod = Math.trunc(period);
  const firstYearMonths = Math.trunc(month);
  if (
    cost <= 0 ||
    salvage < 0 ||
    life <= 0 ||
    currentPeriod < 1 ||
    firstYearMonths < 1 ||
    firstYearMonths > 12
  ) {
    return "#NUM!";
  }
  const rate = Math.round((1 - ((salvage / cost) ** (1 / life))) * 1000) / 1000;
  let bookValue = cost;
  for (let index = 1; index <= currentPeriod; index += 1) {
    const periodFraction =
      index === 1 ? firstYearMonths / 12 : index > life ? (12 - firstYearMonths) / 12 : 1;
    const depreciation = Math.min(
      bookValue - salvage,
      bookValue * rate * periodFraction,
    );
    if (index === currentPeriod) return Math.max(0, depreciation);
    bookValue -= depreciation;
  }
  return 0;
}

function spreadsheetFormulaDoubleDecliningDepreciation(
  cost: number,
  salvage: number,
  life: number,
  period: number,
  factor: number,
) {
  const currentPeriod = Math.trunc(period);
  if (cost < 0 || salvage < 0 || life <= 0 || currentPeriod < 1 || factor <= 0) {
    return "#NUM!";
  }
  let bookValue = cost;
  for (let index = 1; index <= currentPeriod; index += 1) {
    const depreciation = Math.min(bookValue * (factor / life), bookValue - salvage);
    if (index === currentPeriod) return Math.max(0, depreciation);
    bookValue -= depreciation;
  }
  return 0;
}

function spreadsheetFormulaEffectiveRate(nominalRate: number, periodsPerYear: number) {
  const periods = Math.trunc(periodsPerYear);
  if (nominalRate <= 0 || periods < 1) return "#NUM!";
  return ((1 + nominalRate / periods) ** periods) - 1;
}

function spreadsheetFormulaNominalRate(effectRate: number, periodsPerYear: number) {
  const periods = Math.trunc(periodsPerYear);
  if (effectRate <= 0 || periods < 1) return "#NUM!";
  return periods * (((1 + effectRate) ** (1 / periods)) - 1);
}

function spreadsheetFormulaEquivalentRate(
  periods: number,
  presentValue: number,
  futureValue: number,
) {
  if (periods <= 0 || presentValue === 0 || futureValue / presentValue < 0) {
    return "#NUM!";
  }
  return ((futureValue / presentValue) ** (1 / periods)) - 1;
}

function spreadsheetFormulaCashFlowSeries(
  args: Parameters<SpreadsheetFormulaEvaluator>[0],
  numbers: number[],
  trailingParameters: number,
) {
  if (args[0] && typeof args[0] === "object" && "kind" in args[0]) {
    return spreadsheetFormulaFlattenValues([args[0]]).map(spreadsheetFormulaValueNumber);
  }
  return trailingParameters > 0 ? numbers.slice(0, -trailingParameters) : numbers;
}

function spreadsheetFormulaDueType(value: number): 0 | 1 | null {
  const dueType = Math.trunc(value);
  return dueType === 0 || dueType === 1 ? dueType : null;
}
