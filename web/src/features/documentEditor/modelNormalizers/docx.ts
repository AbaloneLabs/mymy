import type {
  DocxComment,
  DocxContentControl,
  DocxField,
  DocxModel,
  DocxNote,
  DocxPageSettings,
  DocxRevision,
  DocxRun,
  DocxStyle,
  DocxTextPart,
} from "../shared/models";
import { hexColorField, isRecord, numericField } from "./shared";

export function normalizeDocxModel(model: unknown): DocxModel {
  if (!isRecord(model) || !Array.isArray(model.blocks)) return { blocks: [] };
  const page = normalizeDocxPageSettings(model.page);
  return {
    page,
    styles: normalizeDocxStyles(model.styles),
    headers: normalizeDocxTextParts(model.headers, "header"),
    footers: normalizeDocxTextParts(model.footers, "footer"),
    comments: normalizeDocxComments(model.comments),
    footnotes: normalizeDocxNotes(model.footnotes, "footnote"),
    endnotes: normalizeDocxNotes(model.endnotes, "endnote"),
    blocks: model.blocks.map((block, index) => {
      const item = isRecord(block) ? block : {};
      const text = typeof item.text === "string" ? item.text : "";
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
        text,
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
        bookmarkId:
          typeof item.bookmarkId === "string" ? item.bookmarkId : undefined,
        bookmarkName:
          typeof item.bookmarkName === "string" ? item.bookmarkName : undefined,
        commentId:
          typeof item.commentId === "string" ? item.commentId : undefined,
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
        imageWrap:
          item.imageWrap === "behind" ||
          item.imageWrap === "inFront" ||
          item.imageWrap === "inline" ||
          item.imageWrap === "square"
            ? item.imageWrap
            : undefined,
        altText: typeof item.altText === "string" ? item.altText : undefined,
        sourceXml:
          typeof item.sourceXml === "string" ? item.sourceXml : undefined,
        paragraphStyleId:
          typeof item.paragraphStyleId === "string"
            ? item.paragraphStyleId
            : undefined,
        paragraphStyleName:
          typeof item.paragraphStyleName === "string"
            ? item.paragraphStyleName
            : undefined,
        runs: normalizeDocxRuns(item.runs, text),
        fields: normalizeDocxFields(item.fields),
        contentControls: normalizeDocxContentControls(item.contentControls),
        revisions: normalizeDocxRevisions(item.revisions),
        bold:
          item.bold === true ? true : item.bold === false ? false : undefined,
        italic:
          item.italic === true ? true : item.italic === false ? false : undefined,
        underline:
          item.underline === true
            ? true
            : item.underline === false
              ? false
              : undefined,
        strikethrough:
          item.strikethrough === true
            ? true
            : item.strikethrough === false
              ? false
              : undefined,
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
        listLevel: clampInteger(numericField(item.listLevel) ?? 0, 0, 8),
        listNumberingId:
          typeof item.listNumberingId === "string"
            ? item.listNumberingId
            : undefined,
        listStart: numericField(item.listStart)
          ? clampInteger(numericField(item.listStart) ?? 1, 1, 100000)
          : undefined,
        indentLeft: numericField(item.indentLeft),
        spacingBefore: numericField(item.spacingBefore),
        spacingAfter: numericField(item.spacingAfter),
        lineSpacing: numericField(item.lineSpacing),
        pageBreakBefore: item.pageBreakBefore === true,
        keepWithNext: item.keepWithNext === true,
        keepLinesTogether: item.keepLinesTogether === true,
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

function normalizeDocxStyles(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const styles = value
    .map((style): DocxStyle | null => {
      const item = isRecord(style) ? style : {};
      if (typeof item.id !== "string" || typeof item.name !== "string") {
        return null;
      }
      return {
        id: item.id,
        name: item.name,
        type:
          item.type === "paragraph" ||
          item.type === "character" ||
          item.type === "table" ||
          item.type === "numbering"
            ? item.type
            : undefined,
        custom: item.custom === true,
        default: item.default === true,
        quickFormat: item.quickFormat === true,
        basedOn: typeof item.basedOn === "string" ? item.basedOn : undefined,
        next: typeof item.next === "string" ? item.next : undefined,
        bold: item.bold === true ? true : undefined,
        italic: item.italic === true ? true : undefined,
        underline: item.underline === true ? true : undefined,
        strikethrough: item.strikethrough === true ? true : undefined,
        verticalAlign:
          item.verticalAlign === "superscript" || item.verticalAlign === "subscript"
            ? item.verticalAlign
            : undefined,
        fontFamily:
          typeof item.fontFamily === "string" ? item.fontFamily : undefined,
        fontSize: typeof item.fontSize === "string" ? item.fontSize : undefined,
        color: hexColorField(item.color),
        highlight:
          typeof item.highlight === "string" ? item.highlight : undefined,
        align:
          item.align === "center" ||
          item.align === "right" ||
          item.align === "left" ||
          item.align === "justify"
            ? item.align
            : undefined,
      };
    })
    .filter((style): style is DocxStyle => style !== null);
  return styles.length > 0 ? styles : undefined;
}

function normalizeDocxRevisions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const revisions = value
    .map((revision, index): DocxRevision | null => {
      const item = isRecord(revision) ? revision : {};
      if (
        item.kind !== "insertion" &&
        item.kind !== "deletion" &&
        item.kind !== "moveFrom" &&
        item.kind !== "moveTo"
      ) {
        return null;
      }
      return {
        id: typeof item.id === "string" ? item.id : `revision${index + 1}`,
        kind: item.kind,
        revisionId:
          typeof item.revisionId === "string" ? item.revisionId : undefined,
        author: typeof item.author === "string" ? item.author : undefined,
        date: typeof item.date === "string" ? item.date : undefined,
        text: typeof item.text === "string" ? item.text : "",
        action:
          item.action === "accept" || item.action === "reject"
            ? item.action
            : undefined,
      };
    })
    .filter((revision): revision is DocxRevision => revision !== null);
  return revisions.length > 0 ? revisions : undefined;
}

function normalizeDocxContentControls(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const controls = value
    .map((control, index): DocxContentControl | null => {
      const item = isRecord(control) ? control : {};
      return {
        id: typeof item.id === "string" ? item.id : `control${index + 1}`,
        kind:
          item.kind === "checkbox" ||
          item.kind === "dropdown" ||
          item.kind === "comboBox" ||
          item.kind === "date" ||
          item.kind === "text"
            ? item.kind
            : "text",
        alias: typeof item.alias === "string" ? item.alias : undefined,
        tag: typeof item.tag === "string" ? item.tag : undefined,
        controlId:
          typeof item.controlId === "string" ? item.controlId : undefined,
        text: typeof item.text === "string" ? item.text : undefined,
        checked: typeof item.checked === "boolean" ? item.checked : undefined,
        items: Array.isArray(item.items)
          ? item.items
              .map((option) => {
                const optionItem = isRecord(option) ? option : {};
                if (typeof optionItem.value !== "string") return null;
                return {
                  value: optionItem.value,
                  displayText:
                    typeof optionItem.displayText === "string"
                      ? optionItem.displayText
                      : undefined,
                };
              })
              .filter((option): option is NonNullable<typeof option> => option !== null)
          : undefined,
      };
    })
    .filter((control): control is DocxContentControl => control !== null);
  return controls.length > 0 ? controls : undefined;
}

function normalizeDocxFields(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const fields = value
    .map((field, index): DocxField | null => {
      const item = isRecord(field) ? field : {};
      if (typeof item.instruction !== "string") return null;
      return {
        id: typeof item.id === "string" ? item.id : `field${index + 1}`,
        source:
          item.source === "simple" || item.source === "complex"
            ? item.source
            : undefined,
        kind: typeof item.kind === "string" ? item.kind : undefined,
        instruction: item.instruction,
        resultText:
          typeof item.resultText === "string" ? item.resultText : undefined,
      };
    })
    .filter((field): field is DocxField => field !== null);
  return fields.length > 0 ? fields : undefined;
}

function normalizeDocxRuns(value: unknown, text: string) {
  if (!Array.isArray(value) || text.length === 0) return undefined;
  const runs = value
    .map((run): DocxRun | null => {
      const item = isRecord(run) ? run : {};
      if (typeof item.text !== "string" || item.text.length === 0) return null;
      return {
        text: item.text,
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
        color: hexColorField(item.color),
        highlight:
          typeof item.highlight === "string" ? item.highlight : undefined,
      };
    })
    .filter((run): run is DocxRun => run !== null);
  if (runs.length === 0 || runs.map((run) => run.text).join("") !== text) {
    return undefined;
  }
  return runs;
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
    columnCount: numericField(value.columnCount),
    columnSpacing: numericField(value.columnSpacing),
    columnEqualWidth:
      typeof value.columnEqualWidth === "boolean"
        ? value.columnEqualWidth
        : undefined,
  };
  return Object.values(page).some((item) => item !== undefined) ? page : undefined;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
