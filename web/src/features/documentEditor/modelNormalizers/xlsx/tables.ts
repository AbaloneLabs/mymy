import type { XlsxTable, XlsxTableColumn } from "../../shared/models";
import { isRecord } from "../shared";

export function normalizeXlsxTable(value: unknown): XlsxTable | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    displayName:
      typeof item.displayName === "string" ? item.displayName : undefined,
    ref: typeof item.ref === "string" ? item.ref : undefined,
    autoFilterRef:
      typeof item.autoFilterRef === "string" ? item.autoFilterRef : undefined,
    totalsRowShown:
      typeof item.totalsRowShown === "boolean" ? item.totalsRowShown : undefined,
    tableStyleName:
      typeof item.tableStyleName === "string" ? item.tableStyleName : undefined,
    showFirstColumn:
      typeof item.showFirstColumn === "boolean" ? item.showFirstColumn : undefined,
    showLastColumn:
      typeof item.showLastColumn === "boolean" ? item.showLastColumn : undefined,
    showRowStripes:
      typeof item.showRowStripes === "boolean" ? item.showRowStripes : undefined,
    showColumnStripes:
      typeof item.showColumnStripes === "boolean" ? item.showColumnStripes : undefined,
    columns: Array.isArray(item.columns)
      ? item.columns
          .map((column) => normalizeXlsxTableColumn(column))
          .filter((column): column is XlsxTableColumn => column !== null)
      : undefined,
  };
}

function normalizeXlsxTableColumn(value: unknown): XlsxTableColumn | null {
  const item = isRecord(value) ? value : {};
  const id =
    typeof item.id === "string"
      ? item.id
      : typeof item.id === "number" && Number.isFinite(item.id)
        ? String(item.id)
        : undefined;
  const name = typeof item.name === "string" ? item.name : undefined;
  const totalsRowFunction =
    typeof item.totalsRowFunction === "string"
      ? item.totalsRowFunction
      : undefined;
  if (!id && !name && !totalsRowFunction) return null;
  return { id, name, totalsRowFunction };
}
