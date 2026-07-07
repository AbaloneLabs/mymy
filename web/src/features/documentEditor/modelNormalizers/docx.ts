import type {
  DocxComment,
  DocxModel,
  DocxNote,
  DocxPageSettings,
  DocxTextPart,
} from "../models";
import { hexColorField, isRecord, numericField } from "./shared";

export function normalizeDocxModel(model: unknown): DocxModel {
  if (!isRecord(model) || !Array.isArray(model.blocks)) return { blocks: [] };
  const page = normalizeDocxPageSettings(model.page);
  return {
    page,
    headers: normalizeDocxTextParts(model.headers, "header"),
    footers: normalizeDocxTextParts(model.footers, "footer"),
    comments: normalizeDocxComments(model.comments),
    footnotes: normalizeDocxNotes(model.footnotes, "footnote"),
    endnotes: normalizeDocxNotes(model.endnotes, "endnote"),
    blocks: model.blocks.map((block, index) => {
      const item = isRecord(block) ? block : {};
      return {
        id: typeof item.id === "string" ? item.id : `p${index + 1}`,
        type:
          item.type === "heading"
            ? "heading"
            : item.type === "table"
              ? "table"
              : item.type === "image"
                ? "image"
                : item.type === "pageBreak"
                  ? "pageBreak"
                  : item.type === "sectionBreak"
                    ? "sectionBreak"
                    : "paragraph",
        text: typeof item.text === "string" ? item.text : "",
        headingLevel:
          item.type === "heading"
            ? clampInteger(numericField(item.headingLevel) ?? 1, 1, 6)
            : undefined,
        rows: Array.isArray(item.rows)
          ? item.rows.map((row) =>
              Array.isArray(row)
                ? row.map((cell) =>
                    typeof cell === "string" ? cell : String(cell ?? ""),
                  )
                : [],
            )
          : undefined,
        tableMergedCells: normalizeDocxTableMergedCells(
          item.tableMergedCells,
          item.rows,
        ),
        tableColumnWidths: Array.isArray(item.tableColumnWidths)
          ? item.tableColumnWidths
              .map((width) => numericField(width))
              .filter((width): width is number => width !== undefined)
          : undefined,
        tableRowHeights: Array.isArray(item.tableRowHeights)
          ? item.tableRowHeights
              .map((height) => numericField(height))
              .filter((height): height is number => height !== undefined)
          : undefined,
        tableStyle:
          typeof item.tableStyle === "string" ? item.tableStyle : undefined,
        tableBorderColor: hexColorField(item.tableBorderColor),
        tableBorderSize: numericField(item.tableBorderSize),
        tableCellBackground: hexColorField(item.tableCellBackground),
        tableHeaderRow: item.tableHeaderRow === true,
        tableHeaderBackground: hexColorField(item.tableHeaderBackground),
        tableCellVerticalAlign:
          item.tableCellVerticalAlign === "center" ||
          item.tableCellVerticalAlign === "bottom" ||
          item.tableCellVerticalAlign === "top"
            ? item.tableCellVerticalAlign
            : undefined,
        relationshipId:
          typeof item.relationshipId === "string" ? item.relationshipId : undefined,
        target: typeof item.target === "string" ? item.target : undefined,
        footnoteId:
          typeof item.footnoteId === "string" ? item.footnoteId : undefined,
        endnoteId:
          typeof item.endnoteId === "string" ? item.endnoteId : undefined,
        mediaPath:
          typeof item.mediaPath === "string" ? item.mediaPath : undefined,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
        dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
        width: numericField(item.width),
        height: numericField(item.height),
        imageRotation: numericField(item.imageRotation),
        imageCropLeft: numericField(item.imageCropLeft),
        imageCropTop: numericField(item.imageCropTop),
        imageCropRight: numericField(item.imageCropRight),
        imageCropBottom: numericField(item.imageCropBottom),
        altText: typeof item.altText === "string" ? item.altText : undefined,
        sourceXml:
          typeof item.sourceXml === "string" ? item.sourceXml : undefined,
        bold: item.bold === true,
        italic: item.italic === true,
        underline: item.underline === true,
        strikethrough: item.strikethrough === true,
        verticalAlign:
          item.verticalAlign === "superscript" || item.verticalAlign === "subscript"
            ? item.verticalAlign
            : undefined,
        fontFamily:
          typeof item.fontFamily === "string" ? item.fontFamily : undefined,
        fontSize: typeof item.fontSize === "string" ? item.fontSize : undefined,
        color: typeof item.color === "string" ? item.color : undefined,
        highlight:
          typeof item.highlight === "string" ? item.highlight : undefined,
        align:
          item.align === "center" ||
          item.align === "right" ||
          item.align === "left" ||
          item.align === "justify"
            ? item.align
            : undefined,
        listKind:
          item.listKind === "bullet" || item.listKind === "number"
            ? item.listKind
            : undefined,
        indentLeft: numericField(item.indentLeft),
        spacingBefore: numericField(item.spacingBefore),
        spacingAfter: numericField(item.spacingAfter),
        lineSpacing: numericField(item.lineSpacing),
        pageBreakBefore: item.pageBreakBefore === true,
        breakKind:
          item.breakKind === "continuous" ||
          item.breakKind === "evenPage" ||
          item.breakKind === "oddPage" ||
          item.breakKind === "nextPage"
            ? item.breakKind
            : undefined,
      };
    }),
  };
}

function normalizeDocxTableMergedCells(value: unknown, rowsValue: unknown) {
  if (!Array.isArray(value) || !Array.isArray(rowsValue)) return undefined;
  const rowCount = rowsValue.length;
  const columnCount = rowsValue.reduce((max, row) => {
    if (!Array.isArray(row)) return max;
    return Math.max(max, row.length);
  }, 0);
  const ranges = value
    .map((range) => {
      const item = isRecord(range) ? range : {};
      const row = clampInteger(numericField(item.row) ?? -1, 0, rowCount - 1);
      const column = clampInteger(
        numericField(item.column) ?? -1,
        0,
        columnCount - 1,
      );
      const rowSpan = clampInteger(
        numericField(item.rowSpan) ?? 1,
        1,
        Math.max(1, rowCount - row),
      );
      const colSpan = clampInteger(
        numericField(item.colSpan) ?? 1,
        1,
        Math.max(1, columnCount - column),
      );
      if (rowCount <= 0 || columnCount <= 0 || (rowSpan === 1 && colSpan === 1)) {
        return null;
      }
      return { row, column, rowSpan, colSpan };
    })
    .filter((range): range is NonNullable<typeof range> => range !== null);
  return ranges.length > 0 ? ranges : undefined;
}

function normalizeDocxTextParts(value: unknown, kind: "header" | "footer") {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part): DocxTextPart | null => {
      const item = isRecord(part) ? part : {};
      if (typeof item.path !== "string") return null;
      return {
        path: item.path,
        kind,
        text: typeof item.text === "string" ? item.text : "",
        sourceXml:
          typeof item.sourceXml === "string" ? item.sourceXml : undefined,
      };
    })
    .filter((part): part is DocxTextPart => part !== null);
  return parts.length > 0 ? parts : undefined;
}

function normalizeDocxComments(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const comments = value
    .map((comment): DocxComment | null => {
      const item = isRecord(comment) ? comment : {};
      if (typeof item.id !== "string") return null;
      return {
        id: item.id,
        author: typeof item.author === "string" ? item.author : undefined,
        date: typeof item.date === "string" ? item.date : undefined,
        text: typeof item.text === "string" ? item.text : "",
        sourceXml:
          typeof item.sourceXml === "string" ? item.sourceXml : undefined,
      };
    })
    .filter((comment): comment is DocxComment => comment !== null);
  return comments.length > 0 ? comments : undefined;
}

function normalizeDocxNotes(value: unknown, kind: "footnote" | "endnote") {
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((note): DocxNote | null => {
      const item = isRecord(note) ? note : {};
      if (typeof item.id !== "string") return null;
      return {
        id: item.id,
        kind,
        text: typeof item.text === "string" ? item.text : "",
        sourceXml:
          typeof item.sourceXml === "string" ? item.sourceXml : undefined,
      };
    })
    .filter((note): note is DocxNote => note !== null);
  return notes.length > 0 ? notes : undefined;
}

function normalizeDocxPageSettings(value: unknown): DocxPageSettings | undefined {
  if (!isRecord(value)) return undefined;
  const page: DocxPageSettings = {
    orientation:
      value.orientation === "landscape" || value.orientation === "portrait"
        ? value.orientation
        : undefined,
    width: numericField(value.width),
    height: numericField(value.height),
    marginTop: numericField(value.marginTop),
    marginRight: numericField(value.marginRight),
    marginBottom: numericField(value.marginBottom),
    marginLeft: numericField(value.marginLeft),
  };
  return Object.values(page).some((item) => item !== undefined) ? page : undefined;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
