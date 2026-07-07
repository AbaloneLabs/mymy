/**
 * Runtime model normalization lives outside the type declarations so editor
 * schemas can grow without turning the shared model module into a mixed type
 * and coercion surface. Keeping the coercion rules together also makes backend
 * compatibility behavior easier to audit.
 */
import type {
  DelimitedTableModel,
  TextModel,
  XlsxCell,
} from "./models";
import { columnName, isRecord } from "./modelNormalizers/shared";

export { columnName, isRecord } from "./modelNormalizers/shared";
export { normalizeDocxModel } from "./modelNormalizers/docx";
export { normalizePptxModel } from "./modelNormalizers/pptx";
export { normalizeXlsxModel } from "./modelNormalizers/xlsx";

export function normalizeTextModel(model: unknown): TextModel {
  if (isRecord(model) && typeof model.content === "string") {
    return {
      content: model.content,
      encoding: typeof model.encoding === "string" ? model.encoding : undefined,
      bom: typeof model.bom === "boolean" ? model.bom : undefined,
      lineEnding: typeof model.lineEnding === "string" ? model.lineEnding : undefined,
      trailingNewline:
        typeof model.trailingNewline === "boolean"
          ? model.trailingNewline
          : undefined,
    };
  }
  return { content: "" };
}

export function normalizeDelimitedTableModel(
  model: unknown,
): DelimitedTableModel {
  if (!isRecord(model) || !Array.isArray(model.rows)) return { rows: [[]] };
  return {
    rows: model.rows.map((row) =>
      Array.isArray(row)
        ? row.map((cell) =>
            typeof cell === "string" ? cell : String(cell ?? ""),
          )
        : [],
    ),
    lineEnding:
      typeof model.lineEnding === "string" ? model.lineEnding : undefined,
    encoding: typeof model.encoding === "string" ? model.encoding : undefined,
    bom: typeof model.bom === "boolean" ? model.bom : undefined,
    quoteStyle:
      model.quoteStyle === "always" || model.quoteStyle === "minimal"
        ? model.quoteStyle
        : undefined,
    trailingNewline:
      typeof model.trailingNewline === "boolean"
        ? model.trailingNewline
        : undefined,
  };
}

export function normalizeRow(row: string[], columnCount: number) {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

export function normalizeXlsxCells(
  cells: XlsxCell[],
  columnCount: number,
  rowIndex: string,
) {
  if (cells.length >= columnCount) return cells;
  return [
    ...cells,
    ...Array.from({ length: columnCount - cells.length }, (_, index) => {
      const columnIndex = cells.length + index;
      return {
        ref: `${columnName(columnIndex)}${rowIndex}`,
        value: "",
      };
    }),
  ];
}

export function isJsonPath(path: string) {
  return /\.json$/i.test(path);
}

export function stableJson(value: unknown) {
  return JSON.stringify(value ?? null);
}
