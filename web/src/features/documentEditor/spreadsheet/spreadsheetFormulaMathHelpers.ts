export function roundSpreadsheetFormulaNumber(
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

export function roundSpreadsheetFormulaMultiple(
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

export function roundSpreadsheetFormulaOddEven(value: number, parity: "odd" | "even") {
  if (value === 0 && parity === "odd") return 1;
  const sign = value < 0 ? -1 : 1;
  let integer = Math.ceil(Math.abs(value));
  if (parity === "odd" && integer % 2 === 0) integer += 1;
  if (parity === "even" && integer % 2 !== 0) integer += 1;
  return sign * integer;
}

export function spreadsheetFormulaVariance(numbers: number[], sample: boolean) {
  const values = numbers.filter(Number.isFinite);
  const denominator = sample ? values.length - 1 : values.length;
  if (denominator <= 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / denominator;
}

export function spreadsheetFormulaStandardDeviation(numbers: number[], sample: boolean) {
  return Math.sqrt(spreadsheetFormulaVariance(numbers, sample));
}

export function spreadsheetFormulaNthSorted(
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

export function spreadsheetFormulaPercentile(numbers: number[], percentile: number) {
  const values = numbers.filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length === 0 || percentile < 0 || percentile > 1) return "#NUM!";
  if (values.length === 1) return values[0] ?? 0;
  const position = (values.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return (values[lower] ?? 0) * (1 - weight) + (values[upper] ?? 0) * weight;
}

export function spreadsheetFormulaNumberValue(
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
