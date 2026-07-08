import type { SpreadsheetFormulaEvaluator } from "./spreadsheetFormula";
import { spreadsheetFormulaValueText } from "./spreadsheetFormulaValues";

export const SPREADSHEET_ENGINEERING_FORMULA_EVALUATORS: Record<
  string,
  SpreadsheetFormulaEvaluator
> = {
  BIN2DEC: (args) =>
    spreadsheetFormulaBaseToDecimal(spreadsheetFormulaValueText(args[0]), 2, 10),
  BIN2HEX: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      2,
      10,
      16,
      10,
    ),
  BIN2OCT: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      2,
      10,
      8,
      10,
    ),
  DEC2BIN: (_args, numbers) =>
    spreadsheetFormulaDecimalToBase(numbers[0] ?? 0, numbers[1], 2, 10),
  HEX2DEC: (args) =>
    spreadsheetFormulaBaseToDecimal(spreadsheetFormulaValueText(args[0]), 16, 10),
  HEX2BIN: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      16,
      10,
      2,
      10,
    ),
  HEX2OCT: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      16,
      10,
      8,
      10,
    ),
  DEC2HEX: (_args, numbers) =>
    spreadsheetFormulaDecimalToBase(numbers[0] ?? 0, numbers[1], 16, 10),
  OCT2DEC: (args) =>
    spreadsheetFormulaBaseToDecimal(spreadsheetFormulaValueText(args[0]), 8, 10),
  OCT2BIN: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      8,
      10,
      2,
      10,
    ),
  OCT2HEX: (args, numbers) =>
    spreadsheetFormulaBaseToBase(
      spreadsheetFormulaValueText(args[0]),
      numbers[1],
      8,
      10,
      16,
      10,
    ),
  DEC2OCT: (_args, numbers) =>
    spreadsheetFormulaDecimalToBase(numbers[0] ?? 0, numbers[1], 8, 10),
  BITAND: (_args, numbers) =>
    spreadsheetFormulaBitwise(numbers[0] ?? 0, numbers[1] ?? 0, "and"),
  BITOR: (_args, numbers) =>
    spreadsheetFormulaBitwise(numbers[0] ?? 0, numbers[1] ?? 0, "or"),
  BITXOR: (_args, numbers) =>
    spreadsheetFormulaBitwise(numbers[0] ?? 0, numbers[1] ?? 0, "xor"),
  BITLSHIFT: (_args, numbers) =>
    spreadsheetFormulaBitShift(numbers[0] ?? 0, numbers[1] ?? 0, "left"),
  BITRSHIFT: (_args, numbers) =>
    spreadsheetFormulaBitShift(numbers[0] ?? 0, numbers[1] ?? 0, "right"),
  DELTA: (_args, numbers) =>
    spreadsheetFormulaEngineeringCompare(numbers[0] ?? 0, numbers[1] ?? 0, "equal"),
  GESTEP: (_args, numbers) =>
    spreadsheetFormulaEngineeringCompare(
      numbers[0] ?? 0,
      numbers[1] ?? 0,
      "greater-or-equal",
    ),
  CONVERT: (args, numbers) =>
    spreadsheetFormulaConvert(
      numbers[0] ?? 0,
      spreadsheetFormulaValueText(args[1]),
      spreadsheetFormulaValueText(args[2]),
    ),
};

function spreadsheetFormulaBaseToDecimal(
  rawValue: string,
  base: 2 | 8 | 16,
  maxDigits: number,
) {
  const value = rawValue.trim();
  const pattern =
    base === 2 ? /^[01]+$/ : base === 8 ? /^[0-7]+$/ : /^[0-9A-Fa-f]+$/;
  if (!value || value.length > maxDigits || !pattern.test(value)) return "#NUM!";
  const parsed = [...value.toUpperCase()].reduce((total, char) => {
    const digit = BigInt(parseInt(char, base));
    return total * BigInt(base) + digit;
  }, 0n);
  const bits = BigInt(maxDigits * Math.log2(base));
  const signBit = 1n << (bits - 1n);
  const modulus = 1n << bits;
  const signed = value.length === maxDigits && parsed >= signBit ? parsed - modulus : parsed;
  return Number(signed);
}

function spreadsheetFormulaBaseToBase(
  rawValue: string,
  places: number | undefined,
  sourceBase: 2 | 8 | 16,
  sourceMaxDigits: number,
  targetBase: 2 | 8 | 16,
  targetMaxDigits: number,
) {
  const decimal = spreadsheetFormulaBaseToDecimal(rawValue, sourceBase, sourceMaxDigits);
  if (typeof decimal !== "number") return decimal;
  return spreadsheetFormulaDecimalToBase(decimal, places, targetBase, targetMaxDigits);
}

function spreadsheetFormulaDecimalToBase(
  value: number,
  places: number | undefined,
  base: 2 | 8 | 16,
  maxDigits: number,
) {
  const integer = Math.trunc(value);
  const bits = BigInt(maxDigits * Math.log2(base));
  const signBit = 1n << (bits - 1n);
  const modulus = 1n << bits;
  if (!Number.isFinite(value) || integer !== value) return "#NUM!";
  if (BigInt(integer) < -signBit || BigInt(integer) >= signBit) return "#NUM!";
  if (integer < 0) {
    return (modulus + BigInt(integer)).toString(base).toUpperCase().padStart(maxDigits, "0");
  }
  const converted = BigInt(integer).toString(base).toUpperCase();
  if (places === undefined) return converted;
  const width = Math.trunc(places);
  if (!Number.isFinite(places) || width !== places || width < 0 || width > maxDigits) {
    return "#NUM!";
  }
  if (converted.length > width) return "#NUM!";
  return converted.padStart(width, "0");
}

function spreadsheetFormulaBitwise(
  left: number,
  right: number,
  operation: "and" | "or" | "xor",
) {
  const leftInteger = spreadsheetFormulaBitInteger(left);
  const rightInteger = spreadsheetFormulaBitInteger(right);
  if (leftInteger === null || rightInteger === null) return "#NUM!";
  const result =
    operation === "and"
      ? leftInteger & rightInteger
      : operation === "or"
        ? leftInteger | rightInteger
        : leftInteger ^ rightInteger;
  return spreadsheetFormulaBigIntResult(result);
}

function spreadsheetFormulaBitShift(
  value: number,
  shiftAmount: number,
  direction: "left" | "right",
) {
  const integer = spreadsheetFormulaBitInteger(value);
  const shift = Math.trunc(shiftAmount);
  if (
    integer === null ||
    !Number.isFinite(shiftAmount) ||
    shift !== shiftAmount ||
    Math.abs(shift) > 53
  ) {
    return "#NUM!";
  }
  const effectiveDirection =
    shift < 0 ? (direction === "left" ? "right" : "left") : direction;
  const distance = BigInt(Math.abs(shift));
  const result =
    effectiveDirection === "left" ? integer << distance : integer >> distance;
  return spreadsheetFormulaBigIntResult(result);
}

function spreadsheetFormulaBitInteger(value: number) {
  const integer = Math.trunc(value);
  if (
    !Number.isFinite(value) ||
    integer !== value ||
    integer < 0 ||
    integer > 281474976710655
  ) {
    return null;
  }
  return BigInt(integer);
}

function spreadsheetFormulaBigIntResult(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return "#NUM!";
  return Number(value);
}

function spreadsheetFormulaEngineeringCompare(
  left: number,
  right: number,
  operation: "equal" | "greater-or-equal",
) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return "#VALUE!";
  return operation === "equal" ? Number(left === right) : Number(left >= right);
}

interface SpreadsheetFormulaConvertUnit {
  category: "length" | "mass" | "time" | "volume" | "area" | "temperature";
  factor: number;
  key: string;
}

const SPREADSHEET_FORMULA_CONVERT_UNITS: Record<string, SpreadsheetFormulaConvertUnit> = {
  m: { category: "length", factor: 1, key: "m" },
  meter: { category: "length", factor: 1, key: "m" },
  meters: { category: "length", factor: 1, key: "m" },
  km: { category: "length", factor: 1000, key: "km" },
  cm: { category: "length", factor: 0.01, key: "cm" },
  mm: { category: "length", factor: 0.001, key: "mm" },
  um: { category: "length", factor: 0.000001, key: "um" },
  nm: { category: "length", factor: 0.000000001, key: "nm" },
  in: { category: "length", factor: 0.0254, key: "in" },
  ft: { category: "length", factor: 0.3048, key: "ft" },
  yd: { category: "length", factor: 0.9144, key: "yd" },
  mi: { category: "length", factor: 1609.344, key: "mi" },
  nmi: { category: "length", factor: 1852, key: "nmi" },
  ang: { category: "length", factor: 1e-10, key: "ang" },
  g: { category: "mass", factor: 1, key: "g" },
  gram: { category: "mass", factor: 1, key: "g" },
  grams: { category: "mass", factor: 1, key: "g" },
  kg: { category: "mass", factor: 1000, key: "kg" },
  mg: { category: "mass", factor: 0.001, key: "mg" },
  lb: { category: "mass", factor: 453.59237, key: "lb" },
  lbm: { category: "mass", factor: 453.59237, key: "lb" },
  oz: { category: "mass", factor: 28.349523125, key: "oz" },
  ozm: { category: "mass", factor: 28.349523125, key: "oz" },
  ton: { category: "mass", factor: 907184.74, key: "ton" },
  sec: { category: "time", factor: 1, key: "sec" },
  s: { category: "time", factor: 1, key: "sec" },
  mn: { category: "time", factor: 60, key: "mn" },
  min: { category: "time", factor: 60, key: "mn" },
  hr: { category: "time", factor: 3600, key: "hr" },
  h: { category: "time", factor: 3600, key: "hr" },
  day: { category: "time", factor: 86400, key: "day" },
  d: { category: "time", factor: 86400, key: "day" },
  l: { category: "volume", factor: 1, key: "l" },
  lt: { category: "volume", factor: 1, key: "l" },
  liter: { category: "volume", factor: 1, key: "l" },
  litre: { category: "volume", factor: 1, key: "l" },
  ml: { category: "volume", factor: 0.001, key: "ml" },
  m3: { category: "volume", factor: 1000, key: "m3" },
  gal: { category: "volume", factor: 3.785411784, key: "gal" },
  qt: { category: "volume", factor: 0.946352946, key: "qt" },
  pt: { category: "volume", factor: 0.473176473, key: "pt" },
  cup: { category: "volume", factor: 0.2365882365, key: "cup" },
  m2: { category: "area", factor: 1, key: "m2" },
  km2: { category: "area", factor: 1_000_000, key: "km2" },
  cm2: { category: "area", factor: 0.0001, key: "cm2" },
  mm2: { category: "area", factor: 0.000001, key: "mm2" },
  ft2: { category: "area", factor: 0.09290304, key: "ft2" },
  in2: { category: "area", factor: 0.00064516, key: "in2" },
  acre: { category: "area", factor: 4046.8564224, key: "acre" },
  c: { category: "temperature", factor: 1, key: "c" },
  cel: { category: "temperature", factor: 1, key: "c" },
  f: { category: "temperature", factor: 1, key: "f" },
  fah: { category: "temperature", factor: 1, key: "f" },
  k: { category: "temperature", factor: 1, key: "k" },
  kel: { category: "temperature", factor: 1, key: "k" },
};

function spreadsheetFormulaConvert(value: number, fromUnit: string, toUnit: string) {
  const from = SPREADSHEET_FORMULA_CONVERT_UNITS[normalizeSpreadsheetFormulaUnit(fromUnit)];
  const to = SPREADSHEET_FORMULA_CONVERT_UNITS[normalizeSpreadsheetFormulaUnit(toUnit)];
  if (!from || !to || from.category !== to.category) return "#N/A";
  if (from.category === "temperature" && to.category === "temperature") {
    return fromBaseTemperature(toBaseTemperature(value, from.key), to.key);
  }
  return value * from.factor / to.factor;
}

function normalizeSpreadsheetFormulaUnit(value: string) {
  return value.trim().toLowerCase();
}

function toBaseTemperature(value: number, unit: string) {
  if (unit === "f") return (value - 32) * 5 / 9 + 273.15;
  if (unit === "c") return value + 273.15;
  return value;
}

function fromBaseTemperature(value: number, unit: string) {
  if (unit === "f") return (value - 273.15) * 9 / 5 + 32;
  if (unit === "c") return value - 273.15;
  return value;
}
