import type {
  XlsxChart,
  XlsxColumn,
  XlsxComment,
  XlsxConditionalFormatting,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxImage,
  XlsxMergedRange,
  XlsxPivot,
  XlsxSheet,
  XlsxTable,
} from "../../shared/models";
import { columnName, isRecord, numericField } from "../shared";
import { normalizeXlsxChart } from "./charts";
import { normalizeXlsxImage } from "./objects";
import { normalizeXlsxPageMargins, normalizeXlsxPageSetup, normalizeXlsxSheetProtection } from "./page";
import { normalizeXlsxPivot } from "./pivots";
import { normalizeXlsxTable } from "./tables";
import {
  normalizeXlsxComment,
  normalizeXlsxConditionalFormatting,
  normalizeXlsxDataValidation,
  normalizeXlsxHyperlink,
} from "./validation";

export function normalizeXlsxSheet(sheet: unknown, sheetIndex: number): XlsxSheet {
  const item = isRecord(sheet) ? sheet : {};
  const rows = Array.isArray(item.rows) ? item.rows : [];
  return {
    id: typeof item.id === "string" ? item.id : `sheet${sheetIndex + 1}`,
    name:
      typeof item.name === "string" ? item.name : `sheet-${sheetIndex + 1}`,
    state:
      item.state === "hidden" || item.state === "veryHidden"
        ? item.state
        : "visible",
    tabColor:
      typeof item.tabColor === "string" ? item.tabColor : undefined,
    tabColorSourceXml:
      typeof item.tabColorSourceXml === "string"
        ? item.tabColorSourceXml
        : undefined,
    columns: Array.isArray(item.columns)
      ? item.columns
          .map((column): XlsxColumn | null => {
            const columnItem = isRecord(column) ? column : {};
            const index =
              typeof columnItem.index === "number" &&
              Number.isFinite(columnItem.index)
                ? columnItem.index
                : null;
            if (index === null) return null;
            const normalized: XlsxColumn = {
              index: Math.max(0, Math.floor(index)),
              hidden: columnItem.hidden === true,
            };
            const width = numericField(columnItem.width);
            if (width !== undefined) {
              normalized.width = width;
            }
            return normalized;
          })
          .filter((column): column is XlsxColumn => column !== null)
      : undefined,
    mergedRanges: Array.isArray(item.mergedRanges)
      ? item.mergedRanges
          .map((range) => {
            const rangeItem = isRecord(range) ? range : {};
            return typeof rangeItem.ref === "string"
              ? { ref: rangeItem.ref }
              : null;
          })
          .filter((range): range is XlsxMergedRange => Boolean(range))
      : undefined,
    dataValidations: Array.isArray(item.dataValidations)
      ? item.dataValidations
          .map((validation) => normalizeXlsxDataValidation(validation))
          .filter(
            (validation): validation is XlsxDataValidation =>
              validation !== null,
          )
      : undefined,
    conditionalFormattings: Array.isArray(item.conditionalFormattings)
      ? item.conditionalFormattings
          .map((formatting) => normalizeXlsxConditionalFormatting(formatting))
          .filter(
            (
              formatting,
            ): formatting is XlsxConditionalFormatting =>
              formatting !== null,
          )
      : undefined,
    hyperlinks: Array.isArray(item.hyperlinks)
      ? item.hyperlinks
          .map((hyperlink) => normalizeXlsxHyperlink(hyperlink))
          .filter(
            (hyperlink): hyperlink is XlsxHyperlink =>
              hyperlink !== null,
          )
      : undefined,
    comments: Array.isArray(item.comments)
      ? item.comments
          .map((comment) => normalizeXlsxComment(comment))
          .filter((comment): comment is XlsxComment => comment !== null)
      : undefined,
    tables: Array.isArray(item.tables)
      ? item.tables
          .map((table) => normalizeXlsxTable(table))
          .filter((table): table is XlsxTable => table !== null)
      : undefined,
    charts: Array.isArray(item.charts)
      ? item.charts
          .map((chart) => normalizeXlsxChart(chart))
          .filter((chart): chart is XlsxChart => chart !== null)
      : undefined,
    images: Array.isArray(item.images)
      ? item.images
          .map((image) => normalizeXlsxImage(image))
          .filter((image): image is XlsxImage => image !== null)
      : undefined,
    pivots: Array.isArray(item.pivots)
      ? item.pivots
          .map((pivot) => normalizeXlsxPivot(pivot))
          .filter((pivot): pivot is XlsxPivot => pivot !== null)
      : undefined,
    protection: normalizeXlsxSheetProtection(item.protection),
    pageMargins: normalizeXlsxPageMargins(item.pageMargins),
    pageSetup: normalizeXlsxPageSetup(item.pageSetup),
    autoFilter:
      typeof item.autoFilter === "string" ? item.autoFilter : undefined,
    frozenRows: numericField(item.frozenRows),
    frozenColumns: numericField(item.frozenColumns),
    rows: rows.map((row, rowIndex) => {
      const rowItem = isRecord(row) ? row : {};
      const cells = Array.isArray(rowItem.cells) ? rowItem.cells : [];
      return {
        index:
          typeof rowItem.index === "string"
            ? rowItem.index
            : String(rowIndex + 1),
        height: numericField(rowItem.height),
        hidden: rowItem.hidden === true,
        cells: cells.map((cell, cellIndex) => {
          const cellItem = isRecord(cell) ? cell : {};
          return {
            ref:
              typeof cellItem.ref === "string"
                ? cellItem.ref
                : `${columnName(cellIndex)}${rowIndex + 1}`,
            value:
              typeof cellItem.value === "string" ? cellItem.value : "",
            formula:
              typeof cellItem.formula === "string"
                ? cellItem.formula
                : undefined,
            formulaType:
              typeof cellItem.formulaType === "string"
                ? cellItem.formulaType
                : undefined,
            formulaRef:
              typeof cellItem.formulaRef === "string"
                ? cellItem.formulaRef
                : undefined,
            formulaSharedIndex:
              typeof cellItem.formulaSharedIndex === "string"
                ? cellItem.formulaSharedIndex
                : undefined,
            generated: cellItem.generated === "spill" ? "spill" : undefined,
            spillParent:
              typeof cellItem.spillParent === "string"
                ? cellItem.spillParent
                : undefined,
            spillRange:
              typeof cellItem.spillRange === "string"
                ? cellItem.spillRange
                : undefined,
            numberFormat:
              typeof cellItem.numberFormat === "string"
                ? cellItem.numberFormat
                : undefined,
            fontFamily:
              typeof cellItem.fontFamily === "string"
                ? cellItem.fontFamily
                : undefined,
            fontSize:
              typeof cellItem.fontSize === "string"
                ? cellItem.fontSize
                : undefined,
            bold: cellItem.bold === true,
            italic: cellItem.italic === true,
            underline: cellItem.underline === true,
            strikethrough: cellItem.strikethrough === true,
            color:
              typeof cellItem.color === "string" ? cellItem.color : undefined,
            fillColor:
              typeof cellItem.fillColor === "string"
                ? cellItem.fillColor
                : undefined,
            align:
              cellItem.align === "left" ||
              cellItem.align === "center" ||
              cellItem.align === "right"
                ? cellItem.align
                : undefined,
            verticalAlign:
              cellItem.verticalAlign === "top" ||
              cellItem.verticalAlign === "middle" ||
              cellItem.verticalAlign === "bottom"
                ? cellItem.verticalAlign
                : undefined,
            wrapText: cellItem.wrapText === true,
          };
        }),
      };
    }),
  };
}
