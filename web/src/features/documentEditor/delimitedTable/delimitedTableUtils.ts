import { columnName } from "../shared/models";

export function delimitedLineEndingValue(value: string | undefined) {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}

export function delimitedColumnHeader(
  columnIndex: number,
  rows: string[][],
  headerRow: boolean,
) {
  const column = columnName(columnIndex);
  const label = headerRow ? rows[0]?.[columnIndex]?.trim() : "";
  return label ? `${column} · ${label}` : column;
}

export function delimitedLooksLikeHeader(rows: string[][]) {
  if (rows.length < 2) return false;
  const first = rows[0] ?? [];
  const second = rows[1] ?? [];
  const columnCount = Math.max(first.length, second.length);
  if (columnCount === 0) return false;
  let labelLike = 0;
  let typeShift = 0;
  for (let index = 0; index < columnCount; index += 1) {
    const header = (first[index] ?? "").trim();
    const value = (second[index] ?? "").trim();
    if (/^[^\d\s].*/.test(header)) labelLike += 1;
    if (header && value && delimitedHeaderCellType(header) !== delimitedHeaderCellType(value)) {
      typeShift += 1;
    }
  }
  return labelLike >= Math.ceil(columnCount / 2) && typeShift > 0;
}

function delimitedHeaderCellType(value: string) {
  const normalized = value.trim();
  if (!normalized) return "empty";
  if (/^(true|false)$/i.test(normalized)) return "boolean";
  if (Number.isFinite(Number(normalized.replace(/,/g, "")))) return "number";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(normalized)) return "date";
  return "text";
}
