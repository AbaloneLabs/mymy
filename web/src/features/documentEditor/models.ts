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
  tableColumnWidths?: number[];
  tableRowHeights?: number[];
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
  autoFilterRef?: string;
  totalsRowShown?: boolean;
  tableStyleName?: string;
  showFirstColumn?: boolean;
  showLastColumn?: boolean;
  showRowStripes?: boolean;
  showColumnStripes?: boolean;
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

export * from "./modelNormalizers";
