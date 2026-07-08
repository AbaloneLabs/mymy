import type { XlsxCell, XlsxSheet } from "./models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import { rangeIndexes } from "./spreadsheetGeometry";
import {
  ensureXlsxRows,
  xlsxFillInputFromCell,
} from "./spreadsheetXlsxModel";
import { normalizeXlsxCells } from "./models";

type FillAxis = "horizontal" | "vertical";

interface SeriesSpec {
  valueAt: (index: number) => string;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_SHORT_NAMES = MONTH_NAMES.map((name) => name.slice(0, 3));
const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY_SHORT_NAMES = WEEKDAY_NAMES.map((name) => name.slice(0, 3));

/**
 * Autofill has to preserve formula-relative behavior while still extending
 * common spreadsheet series. The series detector only takes over when the
 * source values form a recognizable progression; otherwise the same copy logic
 * used by fill down/right is retained.
 */
export function buildXlsxAutofillMatrix({
  sheet,
  columnCount,
  source,
  target,
}: {
  sheet: XlsxSheet;
  columnCount: number;
  source: NormalizedCellRange;
  target: NormalizedCellRange;
}) {
  const axis = spreadsheetAutofillAxis(source, target);
  const sourceHeight = source.bottom - source.top + 1;
  const sourceWidth = source.right - source.left + 1;
  const rows = ensureXlsxRows(
    sheet,
    Math.max(source.bottom, target.bottom) + 1,
    Math.max(columnCount, source.right + 1, target.right + 1),
  );
  const sourceCells = (rowIndex: number) =>
    normalizeXlsxCells(
      rows[rowIndex]?.cells ?? [],
      Math.max(columnCount, source.right + 1, target.right + 1),
      rows[rowIndex]?.index ?? String(rowIndex + 1),
    );
  const verticalSeries =
    axis === "vertical"
      ? rangeIndexes(source.left, source.right).map((column) =>
          inferSeriesSpec(
            rangeIndexes(source.top, source.bottom).map(
              (row) => sourceCells(row)[column],
            ),
          ),
        )
      : [];
  const horizontalSeries =
    axis === "horizontal"
      ? rangeIndexes(source.top, source.bottom).map((row) =>
          inferSeriesSpec(
            rangeIndexes(source.left, source.right).map(
              (column) => sourceCells(row)[column],
            ),
          ),
        )
      : [];

  return rangeIndexes(target.top, target.bottom).map((rowIndex) =>
    rangeIndexes(target.left, target.right).map((columnIndex) => {
      if (axis === "vertical") {
        const sourceColumnOffset = positiveModulo(columnIndex - source.left, sourceWidth);
        const series = verticalSeries[sourceColumnOffset];
        if (series) return series.valueAt(rowIndex - source.top);
      }
      if (axis === "horizontal") {
        const sourceRowOffset = positiveModulo(rowIndex - source.top, sourceHeight);
        const series = horizontalSeries[sourceRowOffset];
        if (series) return series.valueAt(columnIndex - source.left);
      }
      const sourceRowIndex =
        source.top + positiveModulo(rowIndex - source.top, sourceHeight);
      const sourceColumnIndex =
        source.left + positiveModulo(columnIndex - source.left, sourceWidth);
      return xlsxFillInputFromCell(
        sourceCells(sourceRowIndex)[sourceColumnIndex],
        rowIndex - sourceRowIndex,
        columnIndex - sourceColumnIndex,
      );
    }),
  );
}

function spreadsheetAutofillAxis(
  source: NormalizedCellRange,
  target: NormalizedCellRange,
): FillAxis | null {
  const expandsVertically = target.top < source.top || target.bottom > source.bottom;
  const expandsHorizontally = target.left < source.left || target.right > source.right;
  if (expandsVertically && !expandsHorizontally) return "vertical";
  if (expandsHorizontally && !expandsVertically) return "horizontal";
  if (expandsVertically) return "vertical";
  if (expandsHorizontally) return "horizontal";
  return null;
}

function inferSeriesSpec(cells: Array<XlsxCell | undefined>): SeriesSpec | null {
  if (cells.some((cell) => cell?.formula)) return null;
  const values = cells.map((cell) => cell?.value ?? "");
  return (
    inferNumericSeries(values) ??
    inferDateSeries(values) ??
    inferNamedCycleSeries(values, MONTH_NAMES) ??
    inferNamedCycleSeries(values, MONTH_SHORT_NAMES) ??
    inferNamedCycleSeries(values, WEEKDAY_NAMES) ??
    inferNamedCycleSeries(values, WEEKDAY_SHORT_NAMES) ??
    inferTextNumberSeries(values)
  );
}

function inferNumericSeries(values: string[]): SeriesSpec | null {
  const parsed = values.map((value) => Number(value.trim()));
  if (parsed.length < 2 || parsed.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const step = parsed[parsed.length - 1] - parsed[parsed.length - 2];
  const decimals = Math.max(...values.map(decimalPlaces));
  return {
    valueAt: (index) => formatSeriesNumber(parsed[0] + step * index, decimals),
  };
}

function inferDateSeries(values: string[]): SeriesSpec | null {
  const dates = values.map(parseSeriesDate);
  if (dates.some((value) => value === null)) return null;
  const timestamps = dates.map((value) => value?.getTime() ?? 0);
  const step =
    timestamps.length >= 2
      ? timestamps[timestamps.length - 1] - timestamps[timestamps.length - 2]
      : 86400000;
  return {
    valueAt: (index) => {
      const date = new Date(timestamps[0] + step * index);
      return formatSeriesDate(date, values[0]);
    },
  };
}

function inferNamedCycleSeries(values: string[], names: string[]): SeriesSpec | null {
  const indexes = values.map((value) => names.indexOf(value.trim().toLowerCase()));
  if (indexes.some((index) => index < 0)) return null;
  const step =
    indexes.length >= 2
      ? normalizedCycleStep(indexes[indexes.length - 2], indexes[indexes.length - 1], names.length)
      : 1;
  return {
    valueAt: (index) => {
      const value = names[positiveModulo(indexes[0] + step * index, names.length)];
      return preserveSeriesCase(value, values[0]);
    },
  };
}

function inferTextNumberSeries(values: string[]): SeriesSpec | null {
  const parsed = values.map((value) => /^(.*?)(-?\d+)(\D*)$/.exec(value.trim()));
  if (parsed.some((match) => !match)) return null;
  const prefix = parsed[0]?.[1] ?? "";
  const suffix = parsed[0]?.[3] ?? "";
  if (parsed.some((match) => match?.[1] !== prefix || match?.[3] !== suffix)) {
    return null;
  }
  const numbers = parsed.map((match) => Number(match?.[2] ?? 0));
  const width = Math.max(...parsed.map((match) => match?.[2]?.replace("-", "").length ?? 1));
  const step = numbers.length >= 2 ? numbers[numbers.length - 1] - numbers[numbers.length - 2] : 1;
  return {
    valueAt: (index) => {
      const value = numbers[0] + step * index;
      const sign = value < 0 ? "-" : "";
      return `${prefix}${sign}${String(Math.abs(value)).padStart(width, "0")}${suffix}`;
    },
  };
}

function parseSeriesDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2])));
  }
  return null;
}

function formatSeriesDate(date: Date, seed: string) {
  if (/^\d{4}-/.test(seed)) {
    return date.toISOString().slice(0, 10);
  }
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const yearText = /\d{1,2}\/\d{1,2}\/\d{2}$/.test(seed)
    ? String(year).slice(-2)
    : String(year);
  return `${month}/${day}/${yearText}`;
}

function normalizedCycleStep(previous: number, current: number, size: number) {
  const forward = positiveModulo(current - previous, size);
  return forward === 0 ? 1 : forward;
}

function preserveSeriesCase(value: string, seed: string) {
  if (seed.toUpperCase() === seed) return value.toUpperCase();
  if (seed[0]?.toUpperCase() === seed[0]) {
    return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
  }
  return value;
}

function decimalPlaces(value: string) {
  const match = /\.(\d+)/.exec(value);
  return match?.[1]?.length ?? 0;
}

function formatSeriesNumber(value: number, decimals: number) {
  return decimals > 0 ? value.toFixed(decimals) : String(value);
}

function positiveModulo(value: number, divisor: number) {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}
