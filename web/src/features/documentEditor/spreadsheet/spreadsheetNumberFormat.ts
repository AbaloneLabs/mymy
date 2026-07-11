import type { XlsxCell } from "../shared/models";

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Render the supported subset of Excel number formats without changing the
 * stored cell value. Unknown/custom formats deliberately fall back to the raw
 * value so display support can grow without ever feeding an approximation back
 * into workbook data.
 */
export function renderedXlsxCellValue(cell?: XlsxCell, showFormulas = false) {
  if (!cell) return "";
  if (cell.formula && showFormulas) return `=${cell.formula}`;
  return formatXlsxValue(cell.value, cell.numberFormat);
}

export function formatXlsxValue(value: string, numberFormat?: string) {
  const format = numberFormat?.trim();
  if (!format || format.toLowerCase() === "general" || format === "@") return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;

  const normalized = format.toLowerCase();
  if (looksLikeDateFormat(normalized)) {
    return formatExcelDate(numeric, normalized);
  }
  if (normalized.includes("%")) {
    return `${formatNumber(numeric * 100, decimalPlaces(normalized, "%"), false)}%`;
  }

  const currency = currencySymbol(format);
  if (currency) {
    const formatted = formatNumber(
      numeric,
      decimalPlaces(normalized),
      normalized.includes(","),
    );
    return `${currency}${formatted}`;
  }
  if (/^[#0,]+(?:\.[#0]+)?(?:;.*)?$/.test(normalized)) {
    return formatNumber(
      numeric,
      decimalPlaces(normalized),
      normalized.includes(","),
    );
  }
  return value;
}

function formatNumber(value: number, fractionDigits: number, grouping: boolean) {
  return new Intl.NumberFormat(undefined, {
    useGrouping: grouping,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function decimalPlaces(format: string, endMarker?: string) {
  const relevant = endMarker ? format.slice(0, format.indexOf(endMarker)) : format;
  const decimal = /\.([#0]+)/.exec(relevant)?.[1] ?? "";
  return decimal.length;
}

function currencySymbol(format: string) {
  return ["$", "€", "£", "¥"].find((symbol) => format.includes(symbol));
}

function looksLikeDateFormat(format: string) {
  return /^(?:m{1,4}[/-]d{1,4}[/-]y{2,4})(?:\s+h{1,2}:m{1,2}(?::s{1,2})?)?$/i.test(
    format,
  );
}

function formatExcelDate(serial: number, format: string) {
  const date = new Date(EXCEL_EPOCH_UTC + serial * DAY_MILLISECONDS);
  if (Number.isNaN(date.getTime())) return String(serial);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = String(date.getUTCFullYear()).slice(-2);
  const dateValue = `${month}/${day}/${year}`;
  if (!/[hs]/.test(format)) return dateValue;
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dateValue} ${hours}:${minutes}`;
}
