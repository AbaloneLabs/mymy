import type { XlsxPivot, XlsxPivotDataField, XlsxPivotField } from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizeXlsxPivot(value: unknown): XlsxPivot | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    cacheId: typeof item.cacheId === "string" ? item.cacheId : undefined,
    fields: Array.isArray(item.fields)
      ? item.fields
          .map((field) => normalizeXlsxPivotField(field))
          .filter((field): field is XlsxPivotField => field !== null)
      : undefined,
    dataFields: Array.isArray(item.dataFields)
      ? item.dataFields
          .map((field) => normalizeXlsxPivotDataField(field))
          .filter((field): field is XlsxPivotDataField => field !== null)
      : undefined,
  };
}

function normalizeXlsxPivotField(value: unknown): XlsxPivotField | null {
  const item = isRecord(value) ? value : {};
  const index = numericField(item.index);
  if (index === undefined) return null;
  const axis =
    item.axis === "axisRow" ||
    item.axis === "axisCol" ||
    item.axis === "axisPage" ||
    item.axis === "axisValues"
      ? item.axis
      : undefined;
  return {
    index: Math.max(0, Math.floor(index)),
    name: typeof item.name === "string" ? item.name : undefined,
    axis,
    dataField: typeof item.dataField === "boolean" ? item.dataField : undefined,
    showAll: typeof item.showAll === "boolean" ? item.showAll : undefined,
    defaultSubtotal:
      typeof item.defaultSubtotal === "boolean"
        ? item.defaultSubtotal
        : undefined,
    subtotal: typeof item.subtotal === "string" ? item.subtotal : undefined,
  };
}

function normalizeXlsxPivotDataField(
  value: unknown,
): XlsxPivotDataField | null {
  const item = isRecord(value) ? value : {};
  const fieldIndex = numericField(item.fieldIndex);
  if (fieldIndex === undefined) return null;
  return {
    fieldIndex: Math.max(0, Math.floor(fieldIndex)),
    name: typeof item.name === "string" ? item.name : undefined,
    subtotal: typeof item.subtotal === "string" ? item.subtotal : undefined,
  };
}
