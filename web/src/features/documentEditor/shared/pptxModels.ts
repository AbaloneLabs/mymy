export interface PptxText {
  id: string;
  shapeId?: string;
  groupShapeId?: string;
  textSegmentCount?: number;
  complexText?: boolean;
  groupId?: string;
  text: string;
  placeholderType?: string;
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

export type PptxLineArrow = "none" | "triangle" | "stealth" | "diamond" | "oval";

export type PptxShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "line"
  | "straightConnector1"
  | "triangle"
  | "diamond"
  | "parallelogram"
  | "trapezoid"
  | "pentagon"
  | "hexagon"
  | "rightArrow"
  | "leftArrow"
  | "upArrow"
  | "downArrow"
  | "leftRightArrow"
  | "star5"
  | "heart"
  | "cloud";

export interface PptxShape {
  id: string;
  shapeId?: string;
  groupShapeId?: string;
  groupId?: string;
  kind: PptxShapeKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  lineStartArrow?: PptxLineArrow;
  lineEndArrow?: PptxLineArrow;
}

export interface PptxTable {
  id: string;
  shapeId?: string;
  groupShapeId?: string;
  preservationOnly?: boolean;
  groupId?: string;
  textIndexStart?: number;
  rows: string[][];
  cellStyles?: PptxTableCellStyle[][];
  columnWidths?: number[];
  rowHeights?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  tableStyleId?: string;
  firstRow?: boolean;
  firstColumn?: boolean;
  lastRow?: boolean;
  lastColumn?: boolean;
  bandedRows?: boolean;
  bandedColumns?: boolean;
}

export interface PptxTableCellStyle {
  fillColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
}

export interface PptxImage {
  id: string;
  shapeId?: string;
  groupShapeId?: string;
  groupId?: string;
  relationshipId?: string;
  mediaPath?: string;
  mimeType?: string;
  dataUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  imageCropLeft?: number;
  imageCropTop?: number;
  imageCropRight?: number;
  imageCropBottom?: number;
  altText?: string;
}

export interface PptxMedia {
  id: string;
  kind?: "audio" | "video";
  relationshipId?: string;
  mediaPath?: string;
  mimeType?: string;
  shapeId?: string;
  name?: string;
  description?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  timingIndex?: number;
  volumePercent?: number;
  muted?: boolean;
  showWhenStopped?: boolean;
  delayMs?: number;
  durationMs?: number;
}

export interface PptxChartSeries {
  name?: string;
  categories?: string[];
  values?: string[];
}

export interface PptxChart {
  id: string;
  shapeId?: string;
  groupShapeId?: string;
  groupId?: string;
  relationshipId?: string;
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

export interface PptxLayout {
  path: string;
  name?: string;
  type?: string;
  masterPath?: string;
  masterName?: string;
  themePath?: string;
  themeName?: string;
  placeholderTexts?: PptxText[];
}

export interface PptxMaster {
  path: string;
  name?: string;
  themePath?: string;
  themeName?: string;
  placeholderTexts?: PptxText[];
}

export interface PptxTheme {
  path: string;
  name?: string;
  colors?: Record<string, string>;
  majorFont?: string;
  minorFont?: string;
}

export interface PptxTableStyle {
  id: string;
  name?: string;
  default?: boolean;
}

export interface PptxSlide {
  id: string;
  name: string;
  texts: PptxText[];
  shapes?: PptxShape[];
  tables?: PptxTable[];
  images?: PptxImage[];
  media?: PptxMedia[];
  charts?: PptxChart[];
  layoutRelationshipId?: string;
  layoutPath?: string;
  layoutName?: string;
  layoutType?: string;
  layoutMasterPath?: string;
  layoutMasterName?: string;
  layoutThemePath?: string;
  layoutThemeName?: string;
  backgroundKind?: "solid" | "gradient" | "image" | "preserved";
  backgroundColor?: string;
  backgroundGradientStart?: string;
  backgroundGradientEnd?: string;
  backgroundGradientAngle?: number;
  backgroundImageRelationshipId?: string;
  backgroundImageMediaPath?: string;
  backgroundImageMimeType?: string;
  backgroundImageDataUrl?: string;
  backgroundSourceXml?: string;
  notes?: string;
  transition?: PptxTransition;
  animations?: PptxAnimation[];
  animationTimingSourceXml?: string;
  hidden?: boolean;
}

export interface PptxModel {
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  slideSizeType?: string;
  slides: PptxSlide[];
  layouts?: PptxLayout[];
  masters?: PptxMaster[];
  themes?: PptxTheme[];
  tableStyles?: PptxTableStyle[];
}
