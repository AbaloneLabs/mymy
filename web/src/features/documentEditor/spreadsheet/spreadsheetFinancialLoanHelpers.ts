export function spreadsheetFormulaPmt(
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

export function spreadsheetFormulaPv(
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

export function spreadsheetFormulaFv(
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

export function spreadsheetFormulaNper(
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

export function spreadsheetFormulaRate(
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

export function spreadsheetFormulaIpmt(
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

export function spreadsheetFormulaPpmt(
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

export function spreadsheetFormulaCumulativePayment(
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

function spreadsheetFormulaDueType(value: number): 0 | 1 | null {
  const dueType = Math.trunc(value);
  return dueType === 0 || dueType === 1 ? dueType : null;
}
