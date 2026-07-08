import type { XlsxImage, XlsxObjectAnchor, XlsxObjectMarker } from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizeXlsxImage(value: unknown): XlsxImage | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    drawingPath:
      typeof item.drawingPath === "string" ? item.drawingPath : undefined,
    mediaPath: typeof item.mediaPath === "string" ? item.mediaPath : undefined,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
    anchor: normalizeXlsxObjectAnchor(item.anchor),
  };
}

export function normalizeXlsxObjectAnchor(value: unknown): XlsxObjectAnchor | undefined {
  if (!isRecord(value)) return undefined;
  const anchor = {
    from: normalizeXlsxObjectMarker(value.from),
    to: normalizeXlsxObjectMarker(value.to),
  };
  return anchor.from || anchor.to ? anchor : undefined;
}

function normalizeXlsxObjectMarker(value: unknown): XlsxObjectMarker | undefined {
  if (!isRecord(value)) return undefined;
  const marker = {
    column: numericField(value.column),
    columnOffset: numericField(value.columnOffset),
    row: numericField(value.row),
    rowOffset: numericField(value.rowOffset),
  };
  return Object.values(marker).some((item) => item !== undefined)
    ? marker
    : undefined;
}
