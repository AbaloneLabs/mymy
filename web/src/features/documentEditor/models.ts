export interface TextModel {
  content: string;
  encoding?: string;
  bom?: boolean;
  lineEnding?: string;
  trailingNewline?: boolean;
}

export interface DocxBlock {
  id: string;
  type:
    | "paragraph"
    | "heading"
    | "table"
    | "image"
    | "pageBreak"
    | "sectionBreak";
  text: string;
  headingLevel?: number;
  rows?: string[][];
  relationshipId?: string;
  target?: string;
  footnoteId?: string;
  endnoteId?: string;
  mediaPath?: string;
  mimeType?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  altText?: string;
  sourceXml?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  verticalAlign?: "superscript" | "subscript";
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  highlight?: string;
  align?: "left" | "center" | "right" | "justify";
  listKind?: "bullet" | "number";
  indentLeft?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  pageBreakBefore?: boolean;
  breakKind?: "nextPage" | "continuous" | "evenPage" | "oddPage";
}

export interface DocxPageSettings {
  orientation?: "portrait" | "landscape";
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

export interface DocxTextPart {
  path: string;
  kind?: "header" | "footer";
  text: string;
  sourceXml?: string;
}

export interface DocxComment {
  id: string;
  author?: string;
  date?: string;
  text: string;
  sourceXml?: string;
}

export interface DocxNote {
  id: string;
  kind?: "footnote" | "endnote";
  text: string;
  sourceXml?: string;
}

export interface DocxModel {
  blocks: DocxBlock[];
  page?: DocxPageSettings;
  headers?: DocxTextPart[];
  footers?: DocxTextPart[];
  comments?: DocxComment[];
  footnotes?: DocxNote[];
  endnotes?: DocxNote[];
}

export interface XlsxCell {
  ref: string;
  value: string;
  formula?: string;
  numberFormat?: string;
  fontFamily?: string;
  fontSize?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fillColor?: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  wrapText?: boolean;
}

export interface XlsxColumn {
  index: number;
  width?: number;
  hidden?: boolean;
}

export interface XlsxRow {
  index: string;
  cells: XlsxCell[];
  height?: number;
  hidden?: boolean;
}

export interface XlsxMergedRange {
  ref: string;
}

export interface XlsxDataValidation {
  sqref: string;
  type?: "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom";
  operator?:
    | "between"
    | "notBetween"
    | "equal"
    | "notEqual"
    | "greaterThan"
    | "lessThan"
    | "greaterThanOrEqual"
    | "lessThanOrEqual";
  formula1?: string;
  formula2?: string;
  allowBlank?: boolean;
  showInputMessage?: boolean;
  showErrorMessage?: boolean;
  promptTitle?: string;
  prompt?: string;
  errorTitle?: string;
  error?: string;
}

export interface XlsxConditionalRule {
  type?:
    | "cellIs"
    | "expression"
    | "colorScale"
    | "dataBar"
    | "iconSet"
    | "top10"
    | "uniqueValues"
    | "duplicateValues"
    | "containsText"
    | "notContainsText"
    | "beginsWith"
    | "endsWith"
    | "aboveAverage"
    | "timePeriod"
    | "blanks"
    | "notBlanks"
    | "errors"
    | "notErrors";
  operator?:
    | "lessThan"
    | "lessThanOrEqual"
    | "equal"
    | "notEqual"
    | "greaterThanOrEqual"
    | "greaterThan"
    | "between"
    | "notBetween"
    | "containsText"
    | "notContains"
    | "beginsWith"
    | "endsWith";
  priority?: number;
  dxfId?: number;
  fillColor?: string;
  text?: string;
  timePeriod?: string;
  formulas?: string[];
  sourceXml?: string;
}

export interface XlsxConditionalFormatting {
  sqref: string;
  rules: XlsxConditionalRule[];
}

export interface XlsxHyperlink {
  ref: string;
  relationshipId?: string;
  target?: string;
  location?: string;
  display?: string;
  tooltip?: string;
}

export interface XlsxComment {
  ref: string;
  author?: string;
  text: string;
  authorId?: number;
}

export interface XlsxObjectMarker {
  column?: number;
  columnOffset?: number;
  row?: number;
  rowOffset?: number;
}

export interface XlsxObjectAnchor {
  from?: XlsxObjectMarker;
  to?: XlsxObjectMarker;
}

export interface XlsxChart {
  id: string;
  path?: string;
  type?: string;
  title?: string;
  categories?: string[];
  series?: XlsxChartSeries[];
  anchor?: XlsxObjectAnchor;
}

export interface XlsxChartSeries {
  name?: string;
  categories?: string[];
  values?: string[];
}

export interface XlsxTableColumn {
  id?: string;
  name?: string;
  totalsRowFunction?: string;
}

export interface XlsxTable {
  id: string;
  path?: string;
  name?: string;
  displayName?: string;
  ref?: string;
  totalsRowShown?: boolean;
  columns?: XlsxTableColumn[];
}

export interface XlsxImage {
  id: string;
  drawingPath?: string;
  mediaPath?: string;
  mimeType?: string;
  dataUrl?: string;
  anchor?: XlsxObjectAnchor;
}

export interface XlsxPivot {
  id: string;
  path?: string;
  name?: string;
  cacheId?: string;
}

export interface XlsxSheetProtection {
  enabled: boolean;
  password?: string;
  objects?: boolean;
  scenarios?: boolean;
  formatCells?: boolean;
  formatColumns?: boolean;
  formatRows?: boolean;
  insertColumns?: boolean;
  insertRows?: boolean;
  insertHyperlinks?: boolean;
  deleteColumns?: boolean;
  deleteRows?: boolean;
  sort?: boolean;
  autoFilter?: boolean;
  pivotTables?: boolean;
}

export interface XlsxPageMargins {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  header?: number;
  footer?: number;
}

export interface XlsxPageSetup {
  orientation?: "portrait" | "landscape";
  paperSize?: number;
  scale?: number;
  fitToWidth?: number;
  fitToHeight?: number;
}

export interface XlsxSheet {
  id: string;
  name: string;
  state?: "visible" | "hidden" | "veryHidden";
  tabColor?: string;
  tabColorSourceXml?: string;
  rows: XlsxRow[];
  columns?: XlsxColumn[];
  mergedRanges?: XlsxMergedRange[];
  dataValidations?: XlsxDataValidation[];
  conditionalFormattings?: XlsxConditionalFormatting[];
  hyperlinks?: XlsxHyperlink[];
  comments?: XlsxComment[];
  tables?: XlsxTable[];
  charts?: XlsxChart[];
  images?: XlsxImage[];
  pivots?: XlsxPivot[];
  protection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  autoFilter?: string;
  frozenRows?: number;
  frozenColumns?: number;
}

export interface XlsxDefinedName {
  name: string;
  value: string;
  localSheetId?: number;
  hidden?: boolean;
  comment?: string;
  sourceXml?: string;
}

export interface XlsxModel {
  sheets: XlsxSheet[];
  definedNames?: XlsxDefinedName[];
}

export interface DelimitedTableModel {
  rows: string[][];
  encoding?: string;
  bom?: boolean;
  quoteStyle?: "minimal" | "always";
  lineEnding?: string;
  trailingNewline?: boolean;
}

export interface PptxText {
  id: string;
  text: string;
  textIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  fillColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: "left" | "center" | "right";
}

export interface PptxShape {
  id: string;
  kind: "rect" | "ellipse" | "line";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface PptxTable {
  id: string;
  textIndexStart?: number;
  rows: string[][];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface PptxImage {
  id: string;
  relationshipId?: string;
  mediaPath?: string;
  mimeType?: string;
  dataUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  altText?: string;
}

export interface PptxChartSeries {
  name?: string;
  categories?: string[];
  values?: string[];
}

export interface PptxChart {
  id: string;
  relationshipId?: string;
  path?: string;
  type?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  categories?: string[];
  series?: PptxChartSeries[];
}

export interface PptxTransition {
  type?: "none" | "fade" | "push" | "wipe" | "split" | "cut" | "cover" | "uncover" | "zoom";
  speed?: "fast" | "med" | "slow";
  direction?: string;
  advanceOnClick?: boolean;
  advanceAfterMs?: number;
}

export interface PptxAnimation {
  id: string;
  nodeType?: string;
  presetClass?: string;
  presetId?: string;
  targetShapeId?: string;
  delayMs?: number;
  durationMs?: number;
  sourceXml?: string;
}

export interface PptxSlide {
  id: string;
  name: string;
  texts: PptxText[];
  shapes?: PptxShape[];
  tables?: PptxTable[];
  images?: PptxImage[];
  charts?: PptxChart[];
  backgroundColor?: string;
  notes?: string;
  transition?: PptxTransition;
  animations?: PptxAnimation[];
  animationTimingSourceXml?: string;
  hidden?: boolean;
}

export interface PptxModel {
  slides: PptxSlide[];
}

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

export function normalizeXlsxModel(model: unknown): XlsxModel {
  if (!isRecord(model) || !Array.isArray(model.sheets)) return { sheets: [] };
  return {
    definedNames: Array.isArray(model.definedNames)
      ? model.definedNames
          .map((definedName) => normalizeXlsxDefinedName(definedName))
          .filter(
            (definedName): definedName is XlsxDefinedName =>
              definedName !== null,
          )
      : undefined,
    sheets: model.sheets.map((sheet, sheetIndex) => {
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
    }),
  };
}

function normalizeXlsxDefinedName(value: unknown): XlsxDefinedName | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.name !== "string" || item.name.trim() === "") return null;
  return {
    name: item.name,
    value: typeof item.value === "string" ? item.value : "",
    localSheetId: numericField(item.localSheetId),
    hidden: item.hidden === true,
    comment: typeof item.comment === "string" ? item.comment : undefined,
    sourceXml: typeof item.sourceXml === "string" ? item.sourceXml : undefined,
  };
}

function normalizeXlsxDataValidation(value: unknown): XlsxDataValidation | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.sqref !== "string" || item.sqref.trim() === "") {
    return null;
  }
  return {
    sqref: item.sqref,
    type:
      item.type === "whole" ||
      item.type === "decimal" ||
      item.type === "list" ||
      item.type === "date" ||
      item.type === "time" ||
      item.type === "textLength" ||
      item.type === "custom"
        ? item.type
        : undefined,
    operator:
      item.operator === "between" ||
      item.operator === "notBetween" ||
      item.operator === "equal" ||
      item.operator === "notEqual" ||
      item.operator === "greaterThan" ||
      item.operator === "lessThan" ||
      item.operator === "greaterThanOrEqual" ||
      item.operator === "lessThanOrEqual"
        ? item.operator
        : undefined,
    formula1: typeof item.formula1 === "string" ? item.formula1 : undefined,
    formula2: typeof item.formula2 === "string" ? item.formula2 : undefined,
    allowBlank: item.allowBlank === true,
    showInputMessage: item.showInputMessage === true,
    showErrorMessage: item.showErrorMessage === true,
    promptTitle:
      typeof item.promptTitle === "string" ? item.promptTitle : undefined,
    prompt: typeof item.prompt === "string" ? item.prompt : undefined,
    errorTitle:
      typeof item.errorTitle === "string" ? item.errorTitle : undefined,
    error: typeof item.error === "string" ? item.error : undefined,
  };
}

function normalizeXlsxConditionalFormatting(
  value: unknown,
): XlsxConditionalFormatting | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.sqref !== "string" || item.sqref.trim() === "") {
    return null;
  }
  const rules = Array.isArray(item.rules)
    ? item.rules
        .map((rule) => normalizeXlsxConditionalRule(rule))
        .filter((rule): rule is XlsxConditionalRule => rule !== null)
    : [];
  if (rules.length === 0) return null;
  return {
    sqref: item.sqref,
    rules,
  };
}

function normalizeXlsxConditionalRule(
  value: unknown,
): XlsxConditionalRule | null {
  const item = isRecord(value) ? value : {};
  const type = normalizeXlsxConditionalRuleType(item.type);
  const sourceXml =
    typeof item.sourceXml === "string" ? item.sourceXml : undefined;
  if (!type && !sourceXml) return null;
  return {
    type,
    operator: normalizeXlsxConditionalOperator(item.operator),
    priority: numericField(item.priority),
    dxfId: numericField(item.dxfId),
    fillColor:
      typeof item.fillColor === "string" ? item.fillColor : undefined,
    text: typeof item.text === "string" ? item.text : undefined,
    timePeriod:
      typeof item.timePeriod === "string" ? item.timePeriod : undefined,
    formulas: Array.isArray(item.formulas)
      ? item.formulas
          .map((formula) => (typeof formula === "string" ? formula : null))
          .filter((formula): formula is string => formula !== null)
      : undefined,
    sourceXml,
  };
}

function normalizeXlsxConditionalRuleType(
  value: unknown,
): XlsxConditionalRule["type"] {
  return value === "cellIs" ||
    value === "expression" ||
    value === "colorScale" ||
    value === "dataBar" ||
    value === "iconSet" ||
    value === "top10" ||
    value === "uniqueValues" ||
    value === "duplicateValues" ||
    value === "containsText" ||
    value === "notContainsText" ||
    value === "beginsWith" ||
    value === "endsWith" ||
    value === "aboveAverage" ||
    value === "timePeriod" ||
    value === "blanks" ||
    value === "notBlanks" ||
    value === "errors" ||
    value === "notErrors"
    ? value
    : undefined;
}

function normalizeXlsxConditionalOperator(
  value: unknown,
): XlsxConditionalRule["operator"] {
  return value === "lessThan" ||
    value === "lessThanOrEqual" ||
    value === "equal" ||
    value === "notEqual" ||
    value === "greaterThanOrEqual" ||
    value === "greaterThan" ||
    value === "between" ||
    value === "notBetween" ||
    value === "containsText" ||
    value === "notContains" ||
    value === "beginsWith" ||
    value === "endsWith"
    ? value
    : undefined;
}

function normalizeXlsxHyperlink(value: unknown): XlsxHyperlink | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.ref !== "string" || item.ref.trim() === "") return null;
  const target = typeof item.target === "string" ? item.target : undefined;
  const location =
    typeof item.location === "string" ? item.location : undefined;
  if (!target && !location) return null;
  return {
    ref: item.ref,
    relationshipId:
      typeof item.relationshipId === "string"
        ? item.relationshipId
        : undefined,
    target,
    location,
    display: typeof item.display === "string" ? item.display : undefined,
    tooltip: typeof item.tooltip === "string" ? item.tooltip : undefined,
  };
}

function normalizeXlsxComment(value: unknown): XlsxComment | null {
  const item = isRecord(value) ? value : {};
  if (
    typeof item.ref !== "string" ||
    item.ref.trim() === "" ||
    typeof item.text !== "string"
  ) {
    return null;
  }
  return {
    ref: item.ref,
    author: typeof item.author === "string" ? item.author : undefined,
    text: item.text,
    authorId: numericField(item.authorId),
  };
}

function normalizeXlsxChart(value: unknown): XlsxChart | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    type: typeof item.type === "string" ? item.type : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    categories: normalizeChartStringList(item.categories),
    series: Array.isArray(item.series)
      ? item.series
          .map((series) => normalizeXlsxChartSeries(series))
          .filter((series): series is XlsxChartSeries => series !== null)
      : undefined,
    anchor: normalizeXlsxObjectAnchor(item.anchor),
  };
}

function normalizeXlsxChartSeries(value: unknown): XlsxChartSeries | null {
  const item = isRecord(value) ? value : {};
  const series: XlsxChartSeries = {
    name: typeof item.name === "string" ? item.name : undefined,
    categories: normalizeChartStringList(item.categories),
    values: normalizeChartStringList(item.values),
  };
  return Object.values(series).some((field) => field !== undefined)
    ? series
    : null;
}

function normalizeChartStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) =>
    typeof item === "string" ? item : String(item ?? ""),
  );
}

function normalizeXlsxTable(value: unknown): XlsxTable | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    displayName:
      typeof item.displayName === "string" ? item.displayName : undefined,
    ref: typeof item.ref === "string" ? item.ref : undefined,
    totalsRowShown:
      typeof item.totalsRowShown === "boolean" ? item.totalsRowShown : undefined,
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

function normalizeXlsxImage(value: unknown): XlsxImage | null {
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

function normalizeXlsxPivot(value: unknown): XlsxPivot | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    cacheId: typeof item.cacheId === "string" ? item.cacheId : undefined,
  };
}

function normalizeXlsxObjectAnchor(value: unknown): XlsxObjectAnchor | undefined {
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

function normalizeXlsxSheetProtection(
  value: unknown,
): XlsxSheetProtection | undefined {
  const item = isRecord(value) ? value : {};
  if (item.enabled !== true) return undefined;
  return {
    enabled: true,
    password: typeof item.password === "string" ? item.password : undefined,
    objects: item.objects === true,
    scenarios: item.scenarios === true,
    formatCells: item.formatCells === true,
    formatColumns: item.formatColumns === true,
    formatRows: item.formatRows === true,
    insertColumns: item.insertColumns === true,
    insertRows: item.insertRows === true,
    insertHyperlinks: item.insertHyperlinks === true,
    deleteColumns: item.deleteColumns === true,
    deleteRows: item.deleteRows === true,
    sort: item.sort === true,
    autoFilter: item.autoFilter === true,
    pivotTables: item.pivotTables === true,
  };
}

function normalizeXlsxPageMargins(value: unknown): XlsxPageMargins | undefined {
  const item = isRecord(value) ? value : {};
  const margins: XlsxPageMargins = {
    left: numericField(item.left),
    right: numericField(item.right),
    top: numericField(item.top),
    bottom: numericField(item.bottom),
    header: numericField(item.header),
    footer: numericField(item.footer),
  };
  return Object.values(margins).some((margin) => margin !== undefined)
    ? margins
    : undefined;
}

function normalizeXlsxPageSetup(value: unknown): XlsxPageSetup | undefined {
  const item = isRecord(value) ? value : {};
  const setup: XlsxPageSetup = {
    orientation:
      item.orientation === "portrait" || item.orientation === "landscape"
        ? item.orientation
        : undefined,
    paperSize: numericField(item.paperSize),
    scale: numericField(item.scale),
    fitToWidth: numericField(item.fitToWidth),
    fitToHeight: numericField(item.fitToHeight),
  };
  return Object.values(setup).some((field) => field !== undefined)
    ? setup
    : undefined;
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

export function normalizePptxModel(model: unknown): PptxModel {
  if (!isRecord(model) || !Array.isArray(model.slides)) return { slides: [] };
  return {
    slides: model.slides.map((slide, slideIndex) => {
      const item = isRecord(slide) ? slide : {};
      const texts = Array.isArray(item.texts) ? item.texts : [];
      const shapes = Array.isArray(item.shapes) ? item.shapes : [];
      const tables = Array.isArray(item.tables) ? item.tables : [];
      const images = Array.isArray(item.images) ? item.images : [];
      const charts = Array.isArray(item.charts) ? item.charts : [];
      return {
        id: typeof item.id === "string" ? item.id : `slide${slideIndex + 1}`,
        name:
          typeof item.name === "string" ? item.name : `slide-${slideIndex + 1}`,
        backgroundColor:
          typeof item.backgroundColor === "string"
            ? item.backgroundColor
            : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        transition: normalizePptxTransition(item.transition),
        animations: Array.isArray(item.animations)
          ? item.animations
              .map((animation) => normalizePptxAnimation(animation))
              .filter(
                (animation): animation is PptxAnimation => animation !== null,
              )
          : undefined,
        animationTimingSourceXml:
          typeof item.animationTimingSourceXml === "string"
            ? item.animationTimingSourceXml
            : undefined,
        hidden: item.hidden === true,
        texts: texts.map((text, textIndex) => {
          const textItem = isRecord(text) ? text : {};
          return {
            id:
              typeof textItem.id === "string"
                ? textItem.id
                : `t${textIndex + 1}`,
            text: typeof textItem.text === "string" ? textItem.text : "",
            textIndex: numericField(textItem.textIndex),
            x: numericField(textItem.x),
            y: numericField(textItem.y),
            width: numericField(textItem.width),
            height: numericField(textItem.height),
            rotation: numericField(textItem.rotation),
            fontSize:
              typeof textItem.fontSize === "string"
                ? textItem.fontSize
                : undefined,
            fontFamily:
              typeof textItem.fontFamily === "string"
                ? textItem.fontFamily
                : undefined,
            color: typeof textItem.color === "string" ? textItem.color : undefined,
            fillColor:
              typeof textItem.fillColor === "string"
                ? textItem.fillColor
                : undefined,
            bold: textItem.bold === true,
            italic: textItem.italic === true,
            underline: textItem.underline === true,
            strikethrough: textItem.strikethrough === true,
            align:
              textItem.align === "center" ||
              textItem.align === "right" ||
              textItem.align === "left"
                ? textItem.align
                : undefined,
          };
        }),
        shapes: shapes
          .map((shape, shapeIndex): PptxShape | null => {
            const shapeItem = isRecord(shape) ? shape : {};
            const kind =
              shapeItem.kind === "ellipse" ||
              shapeItem.kind === "line" ||
              shapeItem.kind === "rect"
                ? shapeItem.kind
                : null;
            if (!kind) return null;
            return {
              id:
                typeof shapeItem.id === "string"
                  ? shapeItem.id
                  : `s${shapeIndex + 1}`,
              kind,
              x: numericField(shapeItem.x),
              y: numericField(shapeItem.y),
              width: numericField(shapeItem.width),
              height: numericField(shapeItem.height),
              rotation: numericField(shapeItem.rotation),
              fillColor:
                typeof shapeItem.fillColor === "string"
                  ? shapeItem.fillColor
                  : undefined,
              strokeColor:
                typeof shapeItem.strokeColor === "string"
                  ? shapeItem.strokeColor
                  : undefined,
              strokeWidth: numericField(shapeItem.strokeWidth),
            };
          })
          .filter((shape): shape is PptxShape => shape !== null),
        tables: tables
          .map((table, tableIndex): PptxTable | null => {
            const tableItem = isRecord(table) ? table : {};
            const rows = Array.isArray(tableItem.rows) ? tableItem.rows : [];
            const normalizedRows = rows.map((row) =>
              Array.isArray(row)
                ? row.map((cell) =>
                    typeof cell === "string" ? cell : String(cell ?? ""),
                  )
                : [],
            );
            if (normalizedRows.length === 0) return null;
            return {
              id:
                typeof tableItem.id === "string"
                  ? tableItem.id
                  : `tbl${tableIndex + 1}`,
              textIndexStart: numericField(tableItem.textIndexStart),
              rows: normalizedRows,
              x: numericField(tableItem.x),
              y: numericField(tableItem.y),
              width: numericField(tableItem.width),
              height: numericField(tableItem.height),
              rotation: numericField(tableItem.rotation),
            };
          })
          .filter((table): table is PptxTable => table !== null),
        images: images
          .map((image, imageIndex): PptxImage | null => {
            const imageItem = isRecord(image) ? image : {};
            return {
              id:
                typeof imageItem.id === "string"
                  ? imageItem.id
                  : `img${imageIndex + 1}`,
              relationshipId:
                typeof imageItem.relationshipId === "string"
                  ? imageItem.relationshipId
                  : undefined,
              mediaPath:
                typeof imageItem.mediaPath === "string"
                  ? imageItem.mediaPath
                  : undefined,
              mimeType:
                typeof imageItem.mimeType === "string"
                  ? imageItem.mimeType
                  : undefined,
              dataUrl:
                typeof imageItem.dataUrl === "string"
                  ? imageItem.dataUrl
                  : undefined,
              x: numericField(imageItem.x),
              y: numericField(imageItem.y),
              width: numericField(imageItem.width),
              height: numericField(imageItem.height),
              rotation: numericField(imageItem.rotation),
              altText:
                typeof imageItem.altText === "string"
                  ? imageItem.altText
                  : undefined,
            };
          })
          .filter(
            (image): image is PptxImage =>
              image !== null &&
              Boolean(image.dataUrl || image.mediaPath || image.relationshipId),
          ),
        charts: charts
          .map((chart, chartIndex): PptxChart | null => {
            const chartItem = isRecord(chart) ? chart : {};
            return {
              id:
                typeof chartItem.id === "string"
                  ? chartItem.id
                  : `chart${chartIndex + 1}`,
              relationshipId:
                typeof chartItem.relationshipId === "string"
                  ? chartItem.relationshipId
                  : undefined,
              path:
                typeof chartItem.path === "string" ? chartItem.path : undefined,
              type:
                typeof chartItem.type === "string" ? chartItem.type : undefined,
              title:
                typeof chartItem.title === "string"
                  ? chartItem.title
                  : undefined,
              x: numericField(chartItem.x),
              y: numericField(chartItem.y),
              width: numericField(chartItem.width),
              height: numericField(chartItem.height),
              rotation: numericField(chartItem.rotation),
              categories: Array.isArray(chartItem.categories)
                ? chartItem.categories.map((category) =>
                    typeof category === "string"
                      ? category
                      : String(category ?? ""),
                  )
                : undefined,
              series: Array.isArray(chartItem.series)
                ? chartItem.series
                    .map((series): PptxChartSeries | null => {
                      const seriesItem = isRecord(series) ? series : {};
                      return {
                        name:
                          typeof seriesItem.name === "string"
                            ? seriesItem.name
                            : undefined,
                        categories: Array.isArray(seriesItem.categories)
                          ? seriesItem.categories.map((category) =>
                              typeof category === "string"
                                ? category
                                : String(category ?? ""),
                            )
                          : undefined,
                        values: Array.isArray(seriesItem.values)
                          ? seriesItem.values.map((value) =>
                              typeof value === "string"
                                ? value
                                : String(value ?? ""),
                            )
                          : undefined,
                      };
                    })
                    .filter(
                      (series): series is PptxChartSeries => series !== null,
                    )
                : undefined,
            };
          })
          .filter(
            (chart): chart is PptxChart =>
              chart !== null && Boolean(chart.relationshipId || chart.path),
          ),
      };
    }),
  };
}

function normalizePptxAnimation(value: unknown): PptxAnimation | null {
  const item = isRecord(value) ? value : {};
  const id = typeof item.id === "string" ? item.id : undefined;
  if (!id) return null;
  return {
    id,
    nodeType: typeof item.nodeType === "string" ? item.nodeType : undefined,
    presetClass:
      typeof item.presetClass === "string" ? item.presetClass : undefined,
    presetId: typeof item.presetId === "string" ? item.presetId : undefined,
    targetShapeId:
      typeof item.targetShapeId === "string" ? item.targetShapeId : undefined,
    delayMs: numericField(item.delayMs),
    durationMs: numericField(item.durationMs),
    sourceXml: typeof item.sourceXml === "string" ? item.sourceXml : undefined,
  };
}

function normalizePptxTransition(value: unknown): PptxTransition | undefined {
  if (!isRecord(value)) return undefined;
  const transition: PptxTransition = {
    type:
      value.type === "none" ||
      value.type === "fade" ||
      value.type === "push" ||
      value.type === "wipe" ||
      value.type === "split" ||
      value.type === "cut" ||
      value.type === "cover" ||
      value.type === "uncover" ||
      value.type === "zoom"
        ? value.type
        : undefined,
    speed:
      value.speed === "fast" || value.speed === "med" || value.speed === "slow"
        ? value.speed
        : undefined,
    direction:
      typeof value.direction === "string" ? value.direction : undefined,
    advanceOnClick:
      typeof value.advanceOnClick === "boolean"
        ? value.advanceOnClick
        : undefined,
    advanceAfterMs: numericField(value.advanceAfterMs),
  };
  return Object.values(transition).some((field) => field !== undefined)
    ? transition
    : undefined;
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

export function columnName(index: number) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - remainder - 1) / 26);
  }
  return value;
}

export function isJsonPath(path: string) {
  return /\.json$/i.test(path);
}

export function stableJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numericField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
