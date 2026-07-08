export interface TextModel {
  content: string;
  encoding?: string;
  bom?: boolean;
  lineEnding?: string;
  trailingNewline?: boolean;
}

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  verticalAlign?: "superscript" | "subscript";
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  highlight?: string;
}

export interface DocxField {
  id: string;
  source?: "simple" | "complex";
  kind?: string;
  instruction: string;
  resultText?: string;
}

export interface DocxContentControlItem {
  value: string;
  displayText?: string;
}

export interface DocxContentControl {
  id: string;
  kind: "text" | "checkbox" | "dropdown" | "comboBox" | "date";
  alias?: string;
  tag?: string;
  controlId?: string;
  text?: string;
  checked?: boolean;
  items?: DocxContentControlItem[];
}

export interface DocxRevision {
  id: string;
  kind: "insertion" | "deletion" | "moveFrom" | "moveTo";
  revisionId?: string;
  author?: string;
  date?: string;
  text: string;
  action?: "accept" | "reject";
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
  tableMergedCells?: DocxTableMergedCell[];
  tableColumnWidths?: number[];
  tableRowHeights?: number[];
  tableStyle?: string;
  tableBorderColor?: string;
  tableBorderSize?: number;
  tableCellBackground?: string;
  tableHeaderRow?: boolean;
  tableHeaderBackground?: string;
  tableCellVerticalAlign?: "top" | "center" | "bottom";
  relationshipId?: string;
  target?: string;
  bookmarkId?: string;
  bookmarkName?: string;
  commentId?: string;
  footnoteId?: string;
  endnoteId?: string;
  mediaPath?: string;
  mimeType?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  imageRotation?: number;
  imageCropLeft?: number;
  imageCropTop?: number;
  imageCropRight?: number;
  imageCropBottom?: number;
  imageWrap?: DocxImageWrap;
  altText?: string;
  sourceXml?: string;
  paragraphStyleId?: string;
  paragraphStyleName?: string;
  runs?: DocxRun[];
  fields?: DocxField[];
  contentControls?: DocxContentControl[];
  revisions?: DocxRevision[];
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
  listLevel?: number;
  listNumberingId?: string;
  listStart?: number;
  indentLeft?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  pageBreakBefore?: boolean;
  keepWithNext?: boolean;
  keepLinesTogether?: boolean;
  breakKind?: "nextPage" | "continuous" | "evenPage" | "oddPage";
}

export interface DocxStyle {
  id: string;
  name: string;
  type?: "paragraph" | "character" | "table" | "numbering";
  custom?: boolean;
  default?: boolean;
  quickFormat?: boolean;
  basedOn?: string;
  next?: string;
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
}

export interface DocxTableMergedCell {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

export type DocxImageWrap = "inline" | "square" | "behind" | "inFront";

export interface DocxPageSettings {
  orientation?: "portrait" | "landscape";
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  columnCount?: number;
  columnSpacing?: number;
  columnEqualWidth?: boolean;
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
  styles?: DocxStyle[];
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
  formulaType?: string;
  formulaRef?: string;
  formulaSharedIndex?: string;
  generated?: "spill";
  spillParent?: string;
  spillRange?: string;
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
  legendVisible?: boolean;
  legendPosition?: "r" | "l" | "t" | "b" | "tr";
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
  categoryAxisPosition?: "b" | "t";
  valueAxisPosition?: "l" | "r";
  categoryMajorGridlines?: boolean;
  valueMajorGridlines?: boolean;
  categoryAxisTickLabelPosition?: "nextTo" | "low" | "high" | "none";
  valueAxisTickLabelPosition?: "nextTo" | "low" | "high" | "none";
  categoryAxisMajorTickMark?: "cross" | "in" | "out" | "none";
  valueAxisMajorTickMark?: "cross" | "in" | "out" | "none";
  categoryAxisMinorTickMark?: "cross" | "in" | "out" | "none";
  valueAxisMinorTickMark?: "cross" | "in" | "out" | "none";
  categoryAxisNumberFormat?: string;
  valueAxisNumberFormat?: string;
  categoryAxisLineColor?: string;
  valueAxisLineColor?: string;
  categoryAxisLineWidth?: number;
  valueAxisLineWidth?: number;
  categoryAxisLineDash?: "solid" | "dash" | "dot" | "dashDot";
  valueAxisLineDash?: "solid" | "dash" | "dot" | "dashDot";
  categoryAxisLabelTextColor?: string;
  valueAxisLabelTextColor?: string;
  categoryAxisLabelFontSize?: number;
  valueAxisLabelFontSize?: number;
  categoryAxisLabelRotation?: number;
  valueAxisLabelRotation?: number;
  categoryAxisLabelBold?: boolean;
  valueAxisLabelBold?: boolean;
  categoryAxisLabelItalic?: boolean;
  valueAxisLabelItalic?: boolean;
  categories?: string[];
  series?: XlsxChartSeries[];
  anchor?: XlsxObjectAnchor;
}

export interface XlsxChartSeries {
  name?: string;
  nameFormula?: string;
  categories?: string[];
  categoriesFormula?: string;
  values?: string[];
  valuesFormula?: string;
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

export interface XlsxPivotField {
  index: number;
  name?: string;
  axis?: "axisRow" | "axisCol" | "axisPage" | "axisValues";
  dataField?: boolean;
  showAll?: boolean;
  defaultSubtotal?: boolean;
  subtotal?: string;
}

export interface XlsxPivotDataField {
  fieldIndex: number;
  name?: string;
  subtotal?: string;
}

export interface XlsxPivot {
  id: string;
  path?: string;
  name?: string;
  cacheId?: string;
  fields?: XlsxPivotField[];
  dataFields?: XlsxPivotDataField[];
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
  delimiter?: string;
  quoteCharacter?: string;
  escapePolicy?: "double" | "backslash";
  headerRow?: boolean;
  columnTypes?: string[];
  quoteStyle?: "minimal" | "always";
  lineEnding?: string;
  trailingNewline?: boolean;
}

export type {
  PptxAnimation,
  PptxChart,
  PptxChartSeries,
  PptxImage,
  PptxLayout,
  PptxLineArrow,
  PptxMaster,
  PptxMedia,
  PptxModel,
  PptxShape,
  PptxShapeKind,
  PptxSlide,
  PptxTable,
  PptxTableCellStyle,
  PptxTableStyle,
  PptxText,
  PptxTheme,
  PptxTransition,
} from "./pptxModels";

export * from "./modelNormalizers";
