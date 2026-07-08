export function spreadsheetFormulaStraightLineDepreciation(
  cost: number,
  salvage: number,
  life: number,
) {
  if (life <= 0) return "#NUM!";
  return (cost - salvage) / life;
}

export function spreadsheetFormulaSumOfYearsDepreciation(
  cost: number,
  salvage: number,
  life: number,
  period: number,
) {
  if (life <= 0 || period <= 0 || period > life) return "#NUM!";
  return ((cost - salvage) * (life - period + 1) * 2) / (life * (life + 1));
}

export function spreadsheetFormulaFixedDecliningDepreciation(
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

export function spreadsheetFormulaDoubleDecliningDepreciation(
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
