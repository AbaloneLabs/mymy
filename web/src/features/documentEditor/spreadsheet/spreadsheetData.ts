import { normalizeRow } from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";

export const DELIMITED_MATRIX_MIME =
  "application/x-mymy-delimited-matrix+json";

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
  const internal = data.getData(DELIMITED_MATRIX_MIME);
  const internalMatrix = internal ? parseInternalDelimitedMatrix(internal) : null;
  if (internalMatrix) return internalMatrix;
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
  _columnCount: number,
  columnIndex: number,
  direction: "asc" | "desc",
) {
  return rows
    .map((row, originalIndex) => ({
      row,
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

export function sortedDelimitedRowIndexes(
  rows: string[][],
  rowIndexes: number[],
  columnIndex: number,
  direction: "asc" | "desc",
) {
  return rowIndexes
    .map((rowIndex, stableIndex) => ({ rowIndex, stableIndex }))
    .sort((left, right) => {
      const result = compareSpreadsheetValues(
        rows[left.rowIndex]?.[columnIndex] ?? "",
        rows[right.rowIndex]?.[columnIndex] ?? "",
      );
      if (result !== 0) return direction === "asc" ? result : -result;
      return left.stableIndex - right.stableIndex;
    })
    .map(({ rowIndex }) => rowIndex);
}

export function delimitedSortBlockReason(
  rows: string[][],
  rowIndexes: number[],
  columnIndex: number,
) {
  const values = rowIndexes
    .map((rowIndex) => rows[rowIndex]?.[columnIndex]?.trim() ?? "")
    .filter(Boolean);
  const numericCount = values.filter((value) =>
    Number.isFinite(Number(value)),
  ).length;
  if (numericCount > 0 && numericCount < values.length) {
    return "Sort preview blocked: the column mixes numeric and text values";
  }
  return null;
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

export function clipboardTextToMatrix(text: string) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (quoted) {
      if (character === '"' && normalized[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      rows.at(-1)?.push(value);
      value = "";
    } else if (character === "\n") {
      rows.at(-1)?.push(value);
      rows.push([]);
      value = "";
    } else {
      value += character;
    }
  }
  rows.at(-1)?.push(value);
  return rows;
}

export function serializeInternalDelimitedMatrix(values: string[][]) {
  return JSON.stringify({ version: 1, values });
}

function parseInternalDelimitedMatrix(value: string) {
  try {
    const payload: unknown = JSON.parse(value);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("version" in payload) ||
      payload.version !== 1 ||
      !("values" in payload) ||
      !Array.isArray(payload.values)
    ) {
      return null;
    }
    const values = payload.values;
    if (
      !values.every(
        (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"),
      )
    ) {
      return null;
    }
    return values as string[][];
  } catch {
    return null;
  }
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
