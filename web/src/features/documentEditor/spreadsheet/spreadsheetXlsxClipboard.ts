import { adjustSpreadsheetFormulaReferences } from "./spreadsheetFormulaReferences";
import {
  rangeToA1,
  xlsxRangeFromRef,
  type CellPosition,
  type NormalizedCellRange,
} from "./spreadsheetGeometry";
import {
  nonOverlappingComments,
  nonOverlappingConditionalFormattings,
  nonOverlappingDataValidations,
  nonOverlappingHyperlinks,
  rangesOverlap,
  xlsxSqrefRanges,
} from "./spreadsheetXlsxMetadata";
import { ensureXlsxRows } from "./spreadsheetXlsxGridModel";
import { validateXlsxCellInput } from "./spreadsheetValidation";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type {
  XlsxCell,
  XlsxComment,
  XlsxConditionalFormatting,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxMergedRange,
  XlsxModel,
  XlsxSheet,
} from "../shared/models";

export const XLSX_CLIPBOARD_MIME =
  "application/x-mymy-xlsx-selection+json";

export interface XlsxClipboardPayload {
  version: 1;
  sourceSheetId: string;
  sourceOrigin: CellPosition;
  ranges: Array<{
    range: NormalizedCellRange;
    cells: XlsxCell[][];
  }>;
  mergedRanges: XlsxMergedRange[];
  dataValidations: XlsxDataValidation[];
  conditionalFormattings: XlsxConditionalFormatting[];
  hyperlinks: XlsxHyperlink[];
  comments: XlsxComment[];
}

export type BuildXlsxClipboardResult =
  | { payload: XlsxClipboardPayload; reason: null }
  | { payload: null; reason: string };

/**
 * Build one versioned internal payload from the raw workbook model.
 *
 * Plain text remains the interoperable fallback, while this payload owns only
 * cell/range features the current serializer can safely recreate. Unsupported
 * formula groups or opaque conditional XML are rejected before copy so paste
 * cannot look complete while silently flattening package state.
 */
export function buildXlsxClipboardPayload(
  sheet: XlsxSheet,
  selectedRanges: NormalizedCellRange[],
): BuildXlsxClipboardResult {
  if (selectedRanges.length === 0) {
    return { payload: null, reason: "Select at least one range to copy" };
  }
  const sourceOrigin = {
    row: Math.min(...selectedRanges.map((range) => range.top)),
    column: Math.min(...selectedRanges.map((range) => range.left)),
  };
  const complexCell = selectedRanges.some((range) =>
    cellsInRange(sheet, range).some(
      (cell) =>
        cell.formulaType ||
        cell.formulaRef ||
        cell.formulaSharedIndex ||
        cell.generated === "spill" ||
        cell.spillParent ||
        cell.spillRange,
    ),
  );
  if (complexCell) {
    return {
      payload: null,
      reason:
        "Array, shared, and spill formula groups require a workbook-aware copy and were not copied as rich cells",
    };
  }
  const parsedMerges = (sheet.mergedRanges ?? []).flatMap((item) => {
    const range = xlsxRangeFromRef(item.ref);
    return range ? [{ item, range }] : [];
  });
  const partialMerge = parsedMerges.find(
    ({ range }) =>
      selectedRanges.some((selected) => rangesOverlap(range, selected)) &&
      !selectedRanges.some((selected) => rangeContainsRange(selected, range)),
  );
  if (partialMerge) {
    return {
      payload: null,
      reason: `Copy the complete merged range ${partialMerge.item.ref} or exclude it`,
    };
  }
  const opaqueFormatting = (sheet.conditionalFormattings ?? []).find(
    (formatting) =>
      referenceTouchesSelections(formatting.sqref, selectedRanges) &&
      formatting.rules.some((rule) => Boolean(rule.sourceXml)),
  );
  if (opaqueFormatting) {
    return {
      payload: null,
      reason:
        "A selected conditional-format rule is preservation-only and cannot be copied safely",
    };
  }

  return {
    reason: null,
    payload: {
      version: 1,
      sourceSheetId: sheet.id,
      sourceOrigin,
      ranges: selectedRanges.map((range) => ({
        range: { ...range },
        cells: rowsFromRange(sheet, range),
      })),
      mergedRanges: parsedMerges
        .filter(({ range }) =>
          selectedRanges.some((selected) => rangeContainsRange(selected, range)),
        )
        .map(({ item }) => ({ ...item })),
      dataValidations: clipRangeMetadata(
        sheet.dataValidations ?? [],
        (item) => item.sqref,
        (item, ref) => ({ ...item, sqref: ref }),
        selectedRanges,
      ),
      conditionalFormattings: clipRangeMetadata(
        sheet.conditionalFormattings ?? [],
        (item) => item.sqref,
        (item, ref) => ({
          ...item,
          sqref: ref,
          rules: item.rules.map((rule) => ({
            ...rule,
            sourceXml: undefined,
            formulas: rule.formulas ? [...rule.formulas] : undefined,
          })),
        }),
        selectedRanges,
      ),
      hyperlinks: clipRangeMetadata(
        sheet.hyperlinks ?? [],
        (item) => item.ref,
        (item, ref) => ({ ...item, ref, relationshipId: undefined }),
        selectedRanges,
      ),
      comments: clipRangeMetadata(
        sheet.comments ?? [],
        (item) => item.ref,
        (item, ref) => ({ ...item, ref }),
        selectedRanges,
      ),
    },
  };
}

export function serializeXlsxClipboardPayload(payload: XlsxClipboardPayload) {
  return JSON.stringify(payload);
}

export function xlsxClipboardPayloadFromDataTransfer(data: DataTransfer) {
  const encoded = data.getData(XLSX_CLIPBOARD_MIME);
  return encoded ? parseXlsxClipboardPayload(encoded) : null;
}

export function parseXlsxClipboardPayload(encoded: string): XlsxClipboardPayload | null {
  try {
    const value: unknown = JSON.parse(encoded);
    if (!isRecord(value) || value.version !== 1) return null;
    if (
      typeof value.sourceSheetId !== "string" ||
      !isCellPosition(value.sourceOrigin) ||
      !Array.isArray(value.ranges)
    ) {
      return null;
    }
    const ranges = value.ranges.map(parseClipboardRange);
    if (ranges.some((range) => range === null)) return null;
    const mergedRanges = parseArray(value.mergedRanges, parseMergedRange);
    const dataValidations = parseArray(value.dataValidations, parseValidation);
    const conditionalFormattings = parseArray(
      value.conditionalFormattings,
      parseConditionalFormatting,
    );
    const hyperlinks = parseArray(value.hyperlinks, parseHyperlink);
    const comments = parseArray(value.comments, parseComment);
    if (
      !mergedRanges ||
      !dataValidations ||
      !conditionalFormattings ||
      !hyperlinks ||
      !comments
    ) {
      return null;
    }
    return {
      version: 1,
      sourceSheetId: value.sourceSheetId,
      sourceOrigin: value.sourceOrigin,
      ranges: ranges as XlsxClipboardPayload["ranges"],
      mergedRanges,
      dataValidations,
      conditionalFormattings,
      hyperlinks,
      comments,
    };
  } catch {
    return null;
  }
}

export function applyXlsxClipboardPayload(
  model: XlsxModel,
  sheetId: string,
  targetOrigin: CellPosition,
  payload: XlsxClipboardPayload,
):
  | { model: XlsxModel; targetRanges: NormalizedCellRange[]; reason: null }
  | { model: null; targetRanges: []; reason: string } {
  const sheet = model.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) return blockedPaste("The target sheet no longer exists");
  const rowOffset = targetOrigin.row - payload.sourceOrigin.row;
  const columnOffset = targetOrigin.column - payload.sourceOrigin.column;
  const targetRanges = payload.ranges.map(({ range }) =>
    translateRange(range, rowOffset, columnOffset),
  );
  const blockReason = xlsxClipboardPasteBlockReason(sheet, targetRanges);
  if (blockReason) return blockedPaste(blockReason);

  for (const { range, cells } of payload.ranges) {
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        const source = cells[row - range.top]?.[column - range.left];
        if (!source) continue;
        const validation = validateXlsxCellInput(
          model,
          sheet,
          row + rowOffset,
          column + columnOffset,
          source.formula ? `=${source.formula}` : source.value,
        );
        if (!validation.valid) {
          return blockedPaste(
            `${columnName(column + columnOffset)}${row + rowOffset + 1}: ${validation.reason}`,
          );
        }
      }
    }
  }

  const maxRow = Math.max(...targetRanges.map((range) => range.bottom));
  const maxColumn = Math.max(...targetRanges.map((range) => range.right));
  const pastedCells = new Map<string, XlsxCell>();
  payload.ranges.forEach(({ range, cells }) => {
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        const source = cells[row - range.top]?.[column - range.left];
        if (!source) continue;
        const targetRow = row + rowOffset;
        const targetColumn = column + columnOffset;
        pastedCells.set(
          `${targetRow}:${targetColumn}`,
          translatedCell(source, targetRow, targetColumn, rowOffset, columnOffset),
        );
      }
    }
  });
  const rows = ensureXlsxRows(sheet, maxRow + 1, maxColumn + 1).map(
    (row, rowIndex) => ({
      ...row,
      cells: normalizeXlsxCells(
        row.cells,
        Math.max(maxColumn + 1, row.cells.length),
        row.index || String(rowIndex + 1),
      ).map(
        (cell, columnIndex) =>
          pastedCells.get(`${rowIndex}:${columnIndex}`) ?? cell,
      ),
    }),
  );
  const translatedMerges = payload.mergedRanges.map((item) => ({
    ...item,
    ref: translateReference(item.ref, rowOffset, columnOffset),
  }));
  const translatedValidations = payload.dataValidations.map((item) => ({
    ...item,
    sqref: translateReference(item.sqref, rowOffset, columnOffset),
    formula1: translateOptionalFormula(item.formula1, rowOffset, columnOffset),
    formula2: translateOptionalFormula(item.formula2, rowOffset, columnOffset),
  }));
  const translatedFormattings = payload.conditionalFormattings.map((item) => ({
    ...item,
    sqref: translateReference(item.sqref, rowOffset, columnOffset),
    rules: item.rules.map((rule) => ({
      ...rule,
      formulas: rule.formulas?.map((formula) =>
        adjustSpreadsheetFormulaReferences(formula, rowOffset, columnOffset),
      ),
    })),
  }));
  const translatedHyperlinks = payload.hyperlinks.map((item) => ({
    ...item,
    ref: translateReference(item.ref, rowOffset, columnOffset),
    relationshipId: undefined,
    location: translateOptionalFormula(item.location, rowOffset, columnOffset),
  }));
  const translatedComments = payload.comments.map((item) => ({
    ...item,
    ref: translateReference(item.ref, rowOffset, columnOffset),
  }));
  const withoutTarget = <T,>(
    items: T[],
    remove: (items: T[], range: NormalizedCellRange) => T[],
  ) => targetRanges.reduce(remove, items);
  const nextSheet: XlsxSheet = {
    ...sheet,
    rows,
    mergedRanges: [...(sheet.mergedRanges ?? []), ...translatedMerges],
    dataValidations: [
      ...withoutTarget(
        sheet.dataValidations ?? [],
        nonOverlappingDataValidations,
      ),
      ...translatedValidations,
    ],
    conditionalFormattings: [
      ...withoutTarget(
        sheet.conditionalFormattings ?? [],
        nonOverlappingConditionalFormattings,
      ),
      ...translatedFormattings,
    ],
    hyperlinks: [
      ...withoutTarget(sheet.hyperlinks ?? [], nonOverlappingHyperlinks),
      ...translatedHyperlinks,
    ],
    comments: [
      ...withoutTarget(sheet.comments ?? [], nonOverlappingComments),
      ...translatedComments,
    ],
  };
  return {
    model: {
      ...model,
      sheets: model.sheets.map((candidate) =>
        candidate.id === sheet.id ? nextSheet : candidate,
      ),
    },
    targetRanges,
    reason: null,
  };
}

function xlsxClipboardPasteBlockReason(
  sheet: XlsxSheet,
  targetRanges: NormalizedCellRange[],
) {
  if (sheet.protection?.enabled) return "The target sheet is protected";
  if (sheet.autoFilter) return "Clear the saved filter before rich paste";
  if ((sheet.pivots?.length ?? 0) > 0) {
    return "Pivot cache ownership is unknown, so rich paste is blocked";
  }
  if (
    sheet.tables?.some((table) =>
      targetRanges.some((target) =>
        table.ref ? referenceOverlaps(table.ref, target) : false,
      ),
    )
  ) {
    return "The paste target overlaps a table";
  }
  if (
    sheet.mergedRanges?.some((merge) =>
      targetRanges.some((target) => referenceOverlaps(merge.ref, target)),
    )
  ) {
    return "Unmerge the existing target cells before rich paste";
  }
  if (
    targetRanges.some((target) =>
      sheet.rows
        .slice(target.top, target.bottom + 1)
        .some((row) => row.hidden),
    )
  ) {
    return "Unhide target rows before rich paste";
  }
  if (
    targetRanges.some((target) =>
      cellsInRange(sheet, target).some(
        (cell) =>
          cell.formulaRef ||
          cell.formulaType ||
          cell.generated === "spill" ||
          cell.spillParent ||
          cell.spillRange,
      ),
    )
  ) {
    return "The target contains an array, shared, or spill formula group";
  }
  return null;
}

function translatedCell(
  cell: XlsxCell,
  row: number,
  column: number,
  rowOffset: number,
  columnOffset: number,
): XlsxCell {
  return {
    ...cell,
    ref: `${columnName(column)}${row + 1}`,
    formula: cell.formula
      ? adjustSpreadsheetFormulaReferences(cell.formula, rowOffset, columnOffset)
      : undefined,
    formulaType: undefined,
    formulaRef: undefined,
    formulaSharedIndex: undefined,
    generated: undefined,
    spillParent: undefined,
    spillRange: undefined,
  };
}

function rowsFromRange(sheet: XlsxSheet, range: NormalizedCellRange) {
  return Array.from({ length: range.bottom - range.top + 1 }, (_, rowOffset) => {
    const rowIndex = range.top + rowOffset;
    return normalizeXlsxCells(
      sheet.rows[rowIndex]?.cells ?? [],
      range.right + 1,
      sheet.rows[rowIndex]?.index || String(rowIndex + 1),
    )
      .slice(range.left, range.right + 1)
      .map((cell) => ({ ...cell }));
  });
}

function cellsInRange(sheet: XlsxSheet, range: NormalizedCellRange) {
  return rowsFromRange(sheet, range).flat();
}

function clipRangeMetadata<T>(
  items: T[],
  reference: (item: T) => string,
  cloneWithReference: (item: T, reference: string) => T,
  selectedRanges: NormalizedCellRange[],
) {
  return items.flatMap((item) => {
    const intersections = xlsxSqrefRanges(reference(item)).flatMap((source) =>
      selectedRanges.flatMap((selected) => {
        const intersection = intersectRanges(source, selected);
        return intersection ? [intersection] : [];
      }),
    );
    return intersections.length > 0
      ? [cloneWithReference(item, intersections.map(rangeToA1).join(" "))]
      : [];
  });
}

function translateReference(
  reference: string,
  rowOffset: number,
  columnOffset: number,
) {
  return xlsxSqrefRanges(reference)
    .map((range) => rangeToA1(translateRange(range, rowOffset, columnOffset)))
    .join(" ");
}

function translateOptionalFormula(
  value: string | undefined,
  rowOffset: number,
  columnOffset: number,
) {
  return value
    ? adjustSpreadsheetFormulaReferences(value, rowOffset, columnOffset)
    : undefined;
}

function translateRange(
  range: NormalizedCellRange,
  rowOffset: number,
  columnOffset: number,
): NormalizedCellRange {
  return {
    top: range.top + rowOffset,
    right: range.right + columnOffset,
    bottom: range.bottom + rowOffset,
    left: range.left + columnOffset,
  };
}

function intersectRanges(
  left: NormalizedCellRange,
  right: NormalizedCellRange,
) {
  if (!rangesOverlap(left, right)) return null;
  return {
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
    left: Math.max(left.left, right.left),
  };
}

function rangeContainsRange(
  outer: NormalizedCellRange,
  inner: NormalizedCellRange,
) {
  return (
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom &&
    outer.left <= inner.left
  );
}

function referenceTouchesSelections(
  reference: string,
  selectedRanges: NormalizedCellRange[],
) {
  return xlsxSqrefRanges(reference).some((range) =>
    selectedRanges.some((selected) => rangesOverlap(range, selected)),
  );
}

function referenceOverlaps(reference: string, target: NormalizedCellRange) {
  return xlsxSqrefRanges(reference).some((range) => rangesOverlap(range, target));
}

function blockedPaste(reason: string) {
  return { model: null, targetRanges: [] as [], reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCellPosition(value: unknown): value is CellPosition {
  return (
    isRecord(value) &&
    Number.isInteger(value.row) &&
    Number(value.row) >= 0 &&
    Number.isInteger(value.column) &&
    Number(value.column) >= 0
  );
}

function parseClipboardRange(value: unknown) {
  if (!isRecord(value) || !isRange(value.range) || !Array.isArray(value.cells)) {
    return null;
  }
  const cells = value.cells.map((row) =>
    Array.isArray(row) ? row.map(parseCell) : null,
  );
  if (
    cells.some(
      (row) => row === null || row.some((cell) => cell === null),
    )
  ) {
    return null;
  }
  const expectedHeight = value.range.bottom - value.range.top + 1;
  const expectedWidth = value.range.right - value.range.left + 1;
  if (
    cells.length !== expectedHeight ||
    cells.some((row) => row && row.length !== expectedWidth)
  ) {
    return null;
  }
  return {
    range: value.range,
    cells: cells as XlsxCell[][],
  };
}

function isRange(value: unknown): value is NormalizedCellRange {
  return (
    isRecord(value) &&
    Number.isInteger(value.top) &&
    Number.isInteger(value.right) &&
    Number.isInteger(value.bottom) &&
    Number.isInteger(value.left) &&
    Number(value.top) >= 0 &&
    Number(value.left) >= 0 &&
    Number(value.bottom) >= Number(value.top) &&
    Number(value.right) >= Number(value.left)
  );
}

function parseCell(value: unknown): XlsxCell | null {
  if (!isRecord(value) || typeof value.ref !== "string" || typeof value.value !== "string") {
    return null;
  }
  return copyAllowedFields(value, [
    "ref",
    "value",
    "formula",
    "formulaType",
    "formulaRef",
    "formulaSharedIndex",
    "generated",
    "spillParent",
    "spillRange",
    "numberFormat",
    "fontFamily",
    "fontSize",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "color",
    "fillColor",
    "align",
    "verticalAlign",
    "wrapText",
  ]) as unknown as XlsxCell;
}

function parseMergedRange(value: unknown): XlsxMergedRange | null {
  return isRecord(value) && typeof value.ref === "string"
    ? { ref: value.ref }
    : null;
}

function parseValidation(value: unknown): XlsxDataValidation | null {
  return isRecord(value) && typeof value.sqref === "string"
    ? (copyAllowedFields(value, [
        "sqref",
        "type",
        "operator",
        "formula1",
        "formula2",
        "allowBlank",
        "showInputMessage",
        "showErrorMessage",
        "promptTitle",
        "prompt",
        "errorTitle",
        "error",
      ]) as unknown as XlsxDataValidation)
    : null;
}

function parseConditionalFormatting(
  value: unknown,
): XlsxConditionalFormatting | null {
  if (!isRecord(value) || typeof value.sqref !== "string" || !Array.isArray(value.rules)) {
    return null;
  }
  const rules = value.rules.map((rule) => {
    if (!isRecord(rule) || "sourceXml" in rule) return null;
    const sanitized = copyAllowedFields(rule, [
      "type",
      "operator",
      "priority",
      "dxfId",
      "fillColor",
      "text",
      "timePeriod",
    ]);
    if (Array.isArray(rule.formulas)) {
      if (!rule.formulas.every((formula) => typeof formula === "string")) return null;
      sanitized.formulas = [...rule.formulas];
    }
    return sanitized;
  });
  return rules.some((rule) => rule === null)
    ? null
    : { sqref: value.sqref, rules: rules as XlsxConditionalFormatting["rules"] };
}

function parseHyperlink(value: unknown): XlsxHyperlink | null {
  return isRecord(value) && typeof value.ref === "string"
    ? (copyAllowedFields(value, [
        "ref",
        "target",
        "location",
        "display",
        "tooltip",
      ]) as unknown as XlsxHyperlink)
    : null;
}

function parseComment(value: unknown): XlsxComment | null {
  return isRecord(value) &&
    typeof value.ref === "string" &&
    typeof value.text === "string"
    ? (copyAllowedFields(value, [
        "ref",
        "author",
        "text",
        "authorId",
      ]) as unknown as XlsxComment)
    : null;
}

function parseArray<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.some((item) => item === null) ? null : (parsed as T[]);
}

function copyAllowedFields(
  value: Record<string, unknown>,
  fields: string[],
) {
  return Object.fromEntries(
    fields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  );
}
