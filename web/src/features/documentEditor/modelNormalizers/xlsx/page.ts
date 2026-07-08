import type { XlsxPageMargins, XlsxPageSetup, XlsxSheetProtection } from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizeXlsxSheetProtection(
  value: unknown,
): XlsxSheetProtection | undefined {
  const item = isRecord(value) ? value : {};
  if (item.enabled !== true) return undefined;
  return {
    enabled: true,
    password: typeof item.password === "string" ? item.password : undefined,
    objects: item.objects === true,
    scenarios: item.scenarios === true,
    formatCells: item.formatCells === true,
    formatColumns: item.formatColumns === true,
    formatRows: item.formatRows === true,
    insertColumns: item.insertColumns === true,
    insertRows: item.insertRows === true,
    insertHyperlinks: item.insertHyperlinks === true,
    deleteColumns: item.deleteColumns === true,
    deleteRows: item.deleteRows === true,
    sort: item.sort === true,
    autoFilter: item.autoFilter === true,
    pivotTables: item.pivotTables === true,
  };
}

export function normalizeXlsxPageMargins(value: unknown): XlsxPageMargins | undefined {
  const item = isRecord(value) ? value : {};
  const margins: XlsxPageMargins = {
    left: numericField(item.left),
    right: numericField(item.right),
    top: numericField(item.top),
    bottom: numericField(item.bottom),
    header: numericField(item.header),
    footer: numericField(item.footer),
  };
  return Object.values(margins).some((margin) => margin !== undefined)
    ? margins
    : undefined;
}

export function normalizeXlsxPageSetup(value: unknown): XlsxPageSetup | undefined {
  const item = isRecord(value) ? value : {};
  const setup: XlsxPageSetup = {
    orientation:
      item.orientation === "portrait" || item.orientation === "landscape"
        ? item.orientation
        : undefined,
    paperSize: numericField(item.paperSize),
    scale: numericField(item.scale),
    fitToWidth: numericField(item.fitToWidth),
    fitToHeight: numericField(item.fitToHeight),
  };
  return Object.values(setup).some((field) => field !== undefined)
    ? setup
    : undefined;
}
