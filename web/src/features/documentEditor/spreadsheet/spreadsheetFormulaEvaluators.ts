import {
  spreadsheetFormulaAverageIf,
  spreadsheetFormulaAverageIfs,
  spreadsheetFormulaCountIf,
  spreadsheetFormulaCountIfs,
  spreadsheetFormulaSumIf,
  spreadsheetFormulaSumIfs,
} from "./spreadsheetFormulaCriteria";
import { SPREADSHEET_ENGINEERING_FORMULA_EVALUATORS } from "./spreadsheetEngineeringFormulas";
import { SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS } from "./spreadsheetFinancialFormulas";
import {
  excelDateFromSerial,
  excelSerialEndOfMonth,
  excelSerialFromDate,
  excelSerialFromDateParts,
  excelSerialFromDateText,
  excelSerialFromDateTime,
  spreadsheetFormulaWeekday,
} from "./spreadsheetFormulaDateHelpers";
import {
  roundSpreadsheetFormulaMultiple,
  roundSpreadsheetFormulaNumber,
  roundSpreadsheetFormulaOddEven,
  spreadsheetFormulaNthSorted,
  spreadsheetFormulaNumberValue,
  spreadsheetFormulaPercentile,
  spreadsheetFormulaStandardDeviation,
  spreadsheetFormulaVariance,
} from "./spreadsheetFormulaMathHelpers";
import {
  spreadsheetFormulaFilter,
  spreadsheetFormulaIndex,
  spreadsheetFormulaMatch,
  spreadsheetFormulaSort,
  spreadsheetFormulaTableLookup,
  spreadsheetFormulaUnique,
  spreadsheetFormulaXLookup,
  spreadsheetFormulaXMatch,
} from "./spreadsheetFormulaLookupHelpers";
import {
  findSpreadsheetFormulaText,
  spreadsheetFormulaTextAroundDelimiter,
  substituteSpreadsheetFormulaText,
} from "./spreadsheetFormulaTextHelpers";
import type { SpreadsheetFormulaEvaluator } from "./spreadsheetFormulaTypes";
import {
  compareSpreadsheetFormulaValues,
  isSpreadsheetFormulaError,
  isSpreadsheetFormulaNa,
  spreadsheetFormulaFlattenValues,
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
  spreadsheetFormulaValueText,
} from "./spreadsheetFormulaValues";

export const SPREADSHEET_FORMULA_EVALUATORS: Record<
  string,
  SpreadsheetFormulaEvaluator
> = {
  SUM: (_args, numbers) => numbers.reduce((total, value) => total + value, 0),
  AVERAGE: (_args, numbers) =>
    numbers.length === 0
      ? 0
      : numbers.reduce((total, value) => total + value, 0) / numbers.length,
  COUNT: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) =>
        spreadsheetFormulaValueText(value) !== "" && Number.isFinite(Number(value)),
    ).length,
  COUNTIF: (args) => spreadsheetFormulaCountIf(args[0], args[1]),
  COUNTIFS: (args) => spreadsheetFormulaCountIfs(args),
  COUNTA: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) => spreadsheetFormulaValueText(value) !== "",
    ).length,
  SUMIF: (args) => spreadsheetFormulaSumIf(args[0], args[1], args[2]),
  SUMIFS: (args) => spreadsheetFormulaSumIfs(args[0], args.slice(1)),
  AVERAGEIF: (args) => spreadsheetFormulaAverageIf(args[0], args[1], args[2]),
  AVERAGEIFS: (args) => spreadsheetFormulaAverageIfs(args[0], args.slice(1)),
  MIN: (_args, numbers) => (numbers.length === 0 ? 0 : Math.min(...numbers)),
  MAX: (_args, numbers) => (numbers.length === 0 ? 0 : Math.max(...numbers)),
  ABS: (_args, numbers) => Math.abs(numbers[0] ?? 0),
  ROUND: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    const multiplier = 10 ** places;
    return Math.round((numbers[0] ?? 0) * multiplier) / multiplier;
  },
  ROUNDUP: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    return roundSpreadsheetFormulaNumber(numbers[0] ?? 0, places, "away");
  },
  ROUNDDOWN: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    return roundSpreadsheetFormulaNumber(numbers[0] ?? 0, places, "toward");
  },
  POWER: (_args, numbers) => (numbers[0] ?? 0) ** (numbers[1] ?? 0),
  SQRT: (_args, numbers) => Math.sqrt(numbers[0] ?? 0),
  PRODUCT: (_args, numbers) =>
    numbers.length === 0
      ? 0
      : numbers.reduce((total, value) => total * value, 1),
  MEDIAN: (_args, numbers) => {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  },
  MOD: (_args, numbers) => {
    const divisor = numbers[1] ?? 0;
    if (divisor === 0) return 0;
    return (numbers[0] ?? 0) - divisor * Math.floor((numbers[0] ?? 0) / divisor);
  },
  INT: (_args, numbers) => Math.floor(numbers[0] ?? 0),
  CEILING: (_args, numbers) =>
    roundSpreadsheetFormulaMultiple(numbers[0] ?? 0, numbers[1] ?? 1, "up"),
  FLOOR: (_args, numbers) =>
    roundSpreadsheetFormulaMultiple(numbers[0] ?? 0, numbers[1] ?? 1, "down"),
  SUMSQ: (_args, numbers) =>
    numbers.reduce((total, value) => total + value * value, 0),
  SIGN: (_args, numbers) => Math.sign(numbers[0] ?? 0),
  TRUNC: (_args, numbers) => {
    const places = Math.trunc(numbers[1] ?? 0);
    const multiplier = 10 ** places;
    return Math.trunc((numbers[0] ?? 0) * multiplier) / multiplier;
  },
  MROUND: (_args, numbers) => {
    const multiple = numbers[1] ?? 0;
    if (multiple === 0) return 0;
    return Math.round((numbers[0] ?? 0) / multiple) * multiple;
  },
  ODD: (_args, numbers) => roundSpreadsheetFormulaOddEven(numbers[0] ?? 0, "odd"),
  EVEN: (_args, numbers) => roundSpreadsheetFormulaOddEven(numbers[0] ?? 0, "even"),
  RAND: () => Math.random(),
  RANDBETWEEN: (_args, numbers) => {
    const bottom = Math.ceil(Math.min(numbers[0] ?? 0, numbers[1] ?? 0));
    const top = Math.floor(Math.max(numbers[0] ?? 0, numbers[1] ?? 0));
    return Math.floor(Math.random() * (top - bottom + 1)) + bottom;
  },
  COUNTBLANK: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(
      (value) => spreadsheetFormulaValueText(value) === "",
    ).length,
  "STDEV.S": (_args, numbers) => spreadsheetFormulaStandardDeviation(numbers, true),
  "STDEV.P": (_args, numbers) => spreadsheetFormulaStandardDeviation(numbers, false),
  "VAR.S": (_args, numbers) => spreadsheetFormulaVariance(numbers, true),
  "VAR.P": (_args, numbers) => spreadsheetFormulaVariance(numbers, false),
  LARGE: (_args, numbers) =>
    spreadsheetFormulaNthSorted(
      numbers.slice(0, -1),
      Math.trunc(numbers.at(-1) ?? 1),
      "desc",
    ),
  SMALL: (_args, numbers) =>
    spreadsheetFormulaNthSorted(
      numbers.slice(0, -1),
      Math.trunc(numbers.at(-1) ?? 1),
      "asc",
    ),
  "PERCENTILE.INC": (_args, numbers) =>
    spreadsheetFormulaPercentile(numbers.slice(0, -1), numbers.at(-1) ?? 0),
  "QUARTILE.INC": (_args, numbers) =>
    spreadsheetFormulaPercentile(numbers.slice(0, -1), (numbers.at(-1) ?? 0) / 4),
  IF: (args) =>
    spreadsheetFormulaValueBoolean(args[0])
      ? (args[1] ?? true)
      : (args[2] ?? false),
  AND: (args) => spreadsheetFormulaFlattenValues(args).every(spreadsheetFormulaValueBoolean),
  OR: (args) => spreadsheetFormulaFlattenValues(args).some(spreadsheetFormulaValueBoolean),
  NOT: (args) => !spreadsheetFormulaValueBoolean(args[0]),
  TRUE: () => true,
  FALSE: () => false,
  XOR: (args) =>
    spreadsheetFormulaFlattenValues(args).filter(spreadsheetFormulaValueBoolean).length % 2 === 1,
  IFERROR: (args) => (isSpreadsheetFormulaError(args[0]) ? (args[1] ?? "") : (args[0] ?? "")),
  IFNA: (args) => (isSpreadsheetFormulaNa(args[0]) ? (args[1] ?? "") : (args[0] ?? "")),
  IFS: (args) => {
    for (let index = 0; index < args.length; index += 2) {
      if (spreadsheetFormulaValueBoolean(args[index])) return args[index + 1] ?? true;
    }
    return "#N/A";
  },
  SWITCH: (args) => {
    const expression = args[0];
    for (let index = 1; index + 1 < args.length; index += 2) {
      if (compareSpreadsheetFormulaValues(expression ?? "", args[index] ?? "", "=") === true) {
        return args[index + 1] ?? "";
      }
    }
    return args.length % 2 === 0 ? (args.at(-1) ?? "#N/A") : "#N/A";
  },
  LEN: (args) => spreadsheetFormulaValueText(args[0]).length,
  CONCAT: (args) => spreadsheetFormulaFlattenValues(args).map(spreadsheetFormulaValueText).join(""),
  CONCATENATE: (args) =>
    spreadsheetFormulaFlattenValues(args).map(spreadsheetFormulaValueText).join(""),
  TEXTJOIN: (args) => {
    const delimiter = spreadsheetFormulaValueText(args[0]);
    const ignoreEmpty = spreadsheetFormulaValueBoolean(args[1]);
    return spreadsheetFormulaFlattenValues(args.slice(2))
      .map(spreadsheetFormulaValueText)
      .filter((value) => !ignoreEmpty || value !== "")
      .join(delimiter);
  },
  LEFT: (args, numbers) =>
    spreadsheetFormulaValueText(args[0]).slice(
      0,
      Math.max(0, Math.trunc(numbers[1] ?? 1)),
    ),
  RIGHT: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    return text.slice(Math.max(0, text.length - Math.trunc(numbers[1] ?? 1)));
  },
  MID: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    const start = Math.max(0, Math.trunc(numbers[1] ?? 1) - 1);
    return text.slice(start, start + Math.max(0, Math.trunc(numbers[2] ?? 1)));
  },
  LOWER: (args) => spreadsheetFormulaValueText(args[0]).toLowerCase(),
  UPPER: (args) => spreadsheetFormulaValueText(args[0]).toUpperCase(),
  TRIM: (args) => spreadsheetFormulaValueText(args[0]).trim().replace(/\s+/g, " "),
  SUBSTITUTE: (args, numbers) =>
    substituteSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      spreadsheetFormulaValueText(args[2]),
      numbers[3],
    ),
  REPLACE: (args, numbers) => {
    const text = spreadsheetFormulaValueText(args[0]);
    const start = Math.max(0, Math.trunc(numbers[1] ?? 1) - 1);
    const count = Math.max(0, Math.trunc(numbers[2] ?? 0));
    return `${text.slice(0, start)}${spreadsheetFormulaValueText(args[3])}${text.slice(start + count)}`;
  },
  FIND: (args, numbers) =>
    findSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      numbers[2],
      false,
    ),
  SEARCH: (args, numbers) =>
    findSpreadsheetFormulaText(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      numbers[2],
      true,
    ),
  EXACT: (args) =>
    spreadsheetFormulaValueText(args[0]) === spreadsheetFormulaValueText(args[1]),
  VALUE: (args) => spreadsheetFormulaValueNumber(spreadsheetFormulaValueText(args[0])),
  NUMBERVALUE: (args) =>
    spreadsheetFormulaNumberValue(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1] ?? "."),
      spreadsheetFormulaValueText(args[2] ?? ","),
    ),
  CLEAN: (args) =>
    [...spreadsheetFormulaValueText(args[0])]
      .filter((char) => char.charCodeAt(0) >= 32)
      .join(""),
  TEXTBEFORE: (args) =>
    spreadsheetFormulaTextAroundDelimiter(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      "before",
    ),
  TEXTAFTER: (args) =>
    spreadsheetFormulaTextAroundDelimiter(
      spreadsheetFormulaValueText(args[0]),
      spreadsheetFormulaValueText(args[1]),
      "after",
    ),
  TODAY: () => excelSerialFromDate(new Date()),
  NOW: () => excelSerialFromDateTime(new Date()),
  DATE: (_args, numbers) =>
    excelSerialFromDateParts(
      Math.trunc(numbers[0] ?? 1900),
      Math.trunc(numbers[1] ?? 1),
      Math.trunc(numbers[2] ?? 1),
    ),
  YEAR: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCFullYear(),
  MONTH: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCMonth() + 1,
  DAY: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCDate(),
  HOUR: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCHours(),
  MINUTE: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCMinutes(),
  SECOND: (_args, numbers) => excelDateFromSerial(numbers[0] ?? 0).getUTCSeconds(),
  DAYS: (_args, numbers) => Math.trunc((numbers[0] ?? 0) - (numbers[1] ?? 0)),
  TIME: (_args, numbers) =>
    ((Math.trunc(numbers[0] ?? 0) * 3600 +
      Math.trunc(numbers[1] ?? 0) * 60 +
      Math.trunc(numbers[2] ?? 0)) %
      86400) /
    86400,
  DATEVALUE: (args) => excelSerialFromDateText(spreadsheetFormulaValueText(args[0])),
  WEEKDAY: (_args, numbers) => spreadsheetFormulaWeekday(numbers[0] ?? 0, numbers[1] ?? 1),
  EOMONTH: (_args, numbers) => excelSerialEndOfMonth(numbers[0] ?? 0, numbers[1] ?? 0),
  INDEX: (args) =>
    spreadsheetFormulaIndex(
      args[0],
      Math.trunc(spreadsheetFormulaValueNumber(args[1])),
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
    ),
  MATCH: (args) =>
    spreadsheetFormulaMatch(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 0)),
    ),
  XMATCH: (args) =>
    spreadsheetFormulaXMatch(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 0)),
      Math.trunc(spreadsheetFormulaValueNumber(args[3] ?? 1)),
    ),
  XLOOKUP: (args) =>
    spreadsheetFormulaXLookup(
      args[0] ?? "",
      args[1],
      args[2],
      args[3],
      Math.trunc(spreadsheetFormulaValueNumber(args[4] ?? 0)),
      Math.trunc(spreadsheetFormulaValueNumber(args[5] ?? 1)),
    ),
  VLOOKUP: (args) =>
    spreadsheetFormulaTableLookup(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
      spreadsheetFormulaValueBoolean(args[3] ?? true),
      "vertical",
    ),
  HLOOKUP: (args) =>
    spreadsheetFormulaTableLookup(
      args[0] ?? "",
      args[1],
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
      spreadsheetFormulaValueBoolean(args[3] ?? true),
      "horizontal",
    ),
  CHOOSE: (args) =>
    args[Math.trunc(spreadsheetFormulaValueNumber(args[0] ?? 1))] ?? "#VALUE!",
  FILTER: (args) => spreadsheetFormulaFilter(args[0], args[1], args[2]),
  UNIQUE: (args) => spreadsheetFormulaUnique(args[0]),
  SORT: (args) =>
    spreadsheetFormulaSort(
      args[0],
      Math.trunc(spreadsheetFormulaValueNumber(args[1] ?? 1)),
      Math.trunc(spreadsheetFormulaValueNumber(args[2] ?? 1)),
    ),
  ISBLANK: (args) => spreadsheetFormulaValueText(args[0]) === "",
  ISNUMBER: (args) =>
    typeof args[0] === "number" ||
    (spreadsheetFormulaValueText(args[0]) !== "" &&
      Number.isFinite(Number(args[0]))),
  ISTEXT: (args) => typeof args[0] === "string" && !isSpreadsheetFormulaError(args[0]),
  ISERROR: (args) => isSpreadsheetFormulaError(args[0]),
  ISNA: (args) => isSpreadsheetFormulaNa(args[0]),
  ...SPREADSHEET_FINANCIAL_FORMULA_EVALUATORS,
  ...SPREADSHEET_ENGINEERING_FORMULA_EVALUATORS,
};

export const SPREADSHEET_FORMULA_ERROR_HANDLERS = new Set([
  "IFERROR",
  "IFNA",
  "ISERROR",
  "ISNA",
]);
