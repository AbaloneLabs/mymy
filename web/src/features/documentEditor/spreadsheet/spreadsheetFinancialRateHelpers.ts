export function spreadsheetFormulaEffectiveRate(nominalRate: number, periodsPerYear: number) {
  const periods = Math.trunc(periodsPerYear);
  if (nominalRate <= 0 || periods < 1) return "#NUM!";
  return ((1 + nominalRate / periods) ** periods) - 1;
}

export function spreadsheetFormulaNominalRate(effectRate: number, periodsPerYear: number) {
  const periods = Math.trunc(periodsPerYear);
  if (effectRate <= 0 || periods < 1) return "#NUM!";
  return periods * (((1 + effectRate) ** (1 / periods)) - 1);
}

export function spreadsheetFormulaEquivalentRate(
  periods: number,
  presentValue: number,
  futureValue: number,
) {
  if (periods <= 0 || presentValue === 0 || futureValue / presentValue < 0) {
    return "#NUM!";
  }
  return ((futureValue / presentValue) ** (1 / periods)) - 1;
}
