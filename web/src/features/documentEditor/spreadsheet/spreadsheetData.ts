import { normalizeRow } from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";

export function valuesFromDelimitedRange(
  rows: string[][],
  columnCount: number,
  range: NormalizedCellRange,
) {
  return rows.slice(range.top, range.bottom + 1).map((row) =>
    normalizeRow(row, columnCount).slice(range.left, range.right + 1),
  );
}

export function rangeToClipboardText(values: string[][]) {
  return values
    .map((row) =>
      row
        .map((cell) =>
          cell.includes("\t") || /\r?\n/.test(cell)
            ? `"${cell.replace(/"/g, '""')}"`
            : cell,
        )
        .join("\t"),
    )
    .join("\n");
}

export function clipboardDataToMatrix(data: DataTransfer) {
  const html = data.getData("text/html");
  const htmlMatrix = html ? htmlTableToMatrix(html) : null;
  if (htmlMatrix) return htmlMatrix;
  const text = data.getData("text/plain");
  if (!text.includes("\t") && !/\r?\n/.test(text)) return null;
  return clipboardTextToMatrix(text);
}

export function ensureDelimitedRows(
  rows: string[][],
  requiredRows: number,
  requiredColumns: number,
) {
  return Array.from({ length: Math.max(rows.length, requiredRows) }, (_, rowIndex) =>
    normalizeRow(rows[rowIndex] ?? [], requiredColumns),
  );
}

export function ensureDelimitedDisplayRows(rows: string[][], rowCount: number) {
  return Array.from({ length: Math.max(rows.length, rowCount) }, (_, rowIndex) =>
    rows[rowIndex] ?? [],
  );
}

export function filteredDelimitedRows(
  rows: string[][],
  columnCount: number,
  filterText: string,
) {
  const query = filterText.trim().toLowerCase();
  return rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      if (!query) return true;
      return normalizeRow(row, columnCount).some((cell) =>
        cell.toLowerCase().includes(query),
      );
    });
}

export function sortDelimitedRows(
  rows: string[][],
  columnCount: number,
  columnIndex: number,
  direction: "asc" | "desc",
) {
  return rows
    .map((row, originalIndex) => ({
      row: normalizeRow(row, columnCount),
      originalIndex,
    }))
    .sort((left, right) => {
      const result = compareSpreadsheetValues(
        left.row[columnIndex] ?? "",
        right.row[columnIndex] ?? "",
      );
      if (result !== 0) return direction === "asc" ? result : -result;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ row }) => row);
}

export function compareSpreadsheetValues(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function clipboardTextToMatrix(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((row) => row.split("\t"));
}

function htmlTableToMatrix(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) =>
        normalizeSpreadsheetHtmlCell(cell),
      ),
    )
    .filter((row) => row.length > 0);
  return rows.length > 0 ? rows : null;
}

function normalizeSpreadsheetHtmlCell(cell: Element) {
  return (cell.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}
