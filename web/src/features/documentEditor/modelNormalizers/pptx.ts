import type {
  PptxAnimation,
  PptxChart,
  PptxChartSeries,
  PptxImage,
  PptxLayout,
  PptxMedia,
  PptxModel,
  PptxShape,
  PptxShapeKind,
  PptxTable,
  PptxTableCellStyle,
  PptxTableStyle,
  PptxText,
  PptxTheme,
  PptxTransition,
} from "../models";
import { hexColorField, isRecord, numericField } from "./shared";

const PPTX_SHAPE_KINDS = new Set<PptxShapeKind>([
  "rect",
  "roundRect",
  "ellipse",
  "line",
  "straightConnector1",
  "triangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "hexagon",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "leftRightArrow",
  "star5",
  "heart",
  "cloud",
]);

function normalizePptxShapeKind(value: unknown): PptxShapeKind | null {
  return typeof value === "string" && PPTX_SHAPE_KINDS.has(value as PptxShapeKind)
    ? (value as PptxShapeKind)
    : null;
}

function normalizePptxAxisTickLabelPosition(value: unknown) {
  return value === "nextTo" || value === "low" || value === "high" || value === "none"
    ? value
    : undefined;
}

function normalizePptxAxisTickMark(value: unknown) {
  return value === "cross" || value === "in" || value === "out" || value === "none"
    ? value
    : undefined;
}

function normalizePptxAxisLineDash(value: unknown) {
  return value === "solid" || value === "dash" || value === "dot" || value === "dashDot"
    ? value
    : undefined;
}

function normalizePptxAxisLabelFontSize(value: unknown) {
  const numeric = numericField(value);
  return numeric === undefined ? undefined : Math.max(6, Math.min(72, numeric));
}

function normalizePptxAxisLineWidth(value: unknown) {
  const numeric = numericField(value);
  return numeric === undefined ? undefined : Math.max(0, Math.min(72, numeric));
}

function normalizePptxAxisLabelRotation(value: unknown) {
  const numeric = numericField(value);
  return numeric === undefined ? undefined : Math.max(-90, Math.min(90, numeric));
}

function normalizePptxAxisNumberFormat(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePptxGroupId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePptxLayout(value: unknown): PptxLayout | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
    themePath: typeof value.themePath === "string" ? value.themePath : undefined,
    themeName: typeof value.themeName === "string" ? value.themeName : undefined,
    placeholderTexts: Array.isArray(value.placeholderTexts)
      ? value.placeholderTexts.map((text, index) => normalizePptxText(text, index))
      : undefined,
  };
}

function normalizePptxTheme(value: unknown): PptxTheme | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const colors = isRecord(value.colors)
    ? Object.fromEntries(
        Object.entries(value.colors)
          .map(([key, color]) => [key, hexColorField(color)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
      )
    : undefined;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : undefined,
    colors: colors && Object.keys(colors).length > 0 ? colors : undefined,
    majorFont:
      typeof value.majorFont === "string" ? value.majorFont : undefined,
    minorFont:
      typeof value.minorFont === "string" ? value.minorFont : undefined,
  };
}

function normalizePptxText(value: unknown, textIndex: number): PptxText {
  const textItem = isRecord(value) ? value : {};
  return {
    id:
      typeof textItem.id === "string"
        ? textItem.id
        : `t${textIndex + 1}`,
    groupId: normalizePptxGroupId(textItem.groupId),
    text: typeof textItem.text === "string" ? textItem.text : "",
    placeholderType:
      typeof textItem.placeholderType === "string"
        ? textItem.placeholderType
        : undefined,
    textIndex: numericField(textItem.textIndex),
    x: numericField(textItem.x),
    y: numericField(textItem.y),
    width: numericField(textItem.width),
    height: numericField(textItem.height),
    rotation: numericField(textItem.rotation),
    fontSize:
      typeof textItem.fontSize === "string" ? textItem.fontSize : undefined,
    fontFamily:
      typeof textItem.fontFamily === "string" ? textItem.fontFamily : undefined,
    color: typeof textItem.color === "string" ? textItem.color : undefined,
    fillColor:
      typeof textItem.fillColor === "string" ? textItem.fillColor : undefined,
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
}

function normalizePptxTableStyle(value: unknown): PptxTableStyle | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    default: typeof value.default === "boolean" ? value.default : undefined,
  };
}

function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
  return numbers.length > 0 ? numbers : undefined;
}

function normalizePptxTableCellStyles(
  value: unknown,
): PptxTableCellStyle[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const styles = value.map((row) =>
    Array.isArray(row)
      ? row.map((cell) => {
          const item = isRecord(cell) ? cell : {};
          return {
            fillColor:
              typeof item.fillColor === "string" ? item.fillColor : undefined,
            textColor:
              typeof item.textColor === "string" ? item.textColor : undefined,
            bold: typeof item.bold === "boolean" ? item.bold : undefined,
            italic: typeof item.italic === "boolean" ? item.italic : undefined,
            align: normalizePptxTableCellAlign(item.align),
          };
        })
      : [],
  );
  return styles.length > 0 ? styles : undefined;
}

function normalizePptxTableCellAlign(
  value: unknown,
): PptxTableCellStyle["align"] {
  return value === "left" || value === "center" || value === "right"
    ? value
    : undefined;
}

export function normalizePptxModel(model: unknown): PptxModel {
  if (!isRecord(model) || !Array.isArray(model.slides)) return { slides: [] };
  return {
    layouts: Array.isArray(model.layouts)
      ? model.layouts
          .map((layout) => normalizePptxLayout(layout))
          .filter((layout): layout is PptxLayout => layout !== null)
      : undefined,
    themes: Array.isArray(model.themes)
      ? model.themes
          .map((theme) => normalizePptxTheme(theme))
          .filter((theme): theme is PptxTheme => theme !== null)
      : undefined,
    tableStyles: Array.isArray(model.tableStyles)
      ? model.tableStyles
          .map((style) => normalizePptxTableStyle(style))
          .filter((style): style is PptxTableStyle => style !== null)
      : undefined,
    slides: model.slides.map((slide, slideIndex) => {
      const item = isRecord(slide) ? slide : {};
      const texts = Array.isArray(item.texts) ? item.texts : [];
      const shapes = Array.isArray(item.shapes) ? item.shapes : [];
      const tables = Array.isArray(item.tables) ? item.tables : [];
      const images = Array.isArray(item.images) ? item.images : [];
      const media = Array.isArray(item.media) ? item.media : [];
      const charts = Array.isArray(item.charts) ? item.charts : [];
      return {
        id: typeof item.id === "string" ? item.id : `slide${slideIndex + 1}`,
        name:
          typeof item.name === "string" ? item.name : `slide-${slideIndex + 1}`,
        backgroundColor:
          typeof item.backgroundColor === "string"
            ? item.backgroundColor
            : undefined,
        backgroundKind:
          item.backgroundKind === "solid" ||
          item.backgroundKind === "gradient" ||
          item.backgroundKind === "image" ||
          item.backgroundKind === "preserved"
            ? item.backgroundKind
            : undefined,
        backgroundGradientStart:
          typeof item.backgroundGradientStart === "string"
            ? item.backgroundGradientStart
            : undefined,
        backgroundGradientEnd:
          typeof item.backgroundGradientEnd === "string"
            ? item.backgroundGradientEnd
            : undefined,
        backgroundGradientAngle: numericField(item.backgroundGradientAngle),
        backgroundImageRelationshipId:
          typeof item.backgroundImageRelationshipId === "string"
            ? item.backgroundImageRelationshipId
            : undefined,
        backgroundImageMediaPath:
          typeof item.backgroundImageMediaPath === "string"
            ? item.backgroundImageMediaPath
            : undefined,
        backgroundImageMimeType:
          typeof item.backgroundImageMimeType === "string"
            ? item.backgroundImageMimeType
            : undefined,
        backgroundImageDataUrl:
          typeof item.backgroundImageDataUrl === "string"
            ? item.backgroundImageDataUrl
            : undefined,
        backgroundSourceXml:
          typeof item.backgroundSourceXml === "string"
            ? item.backgroundSourceXml
            : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        layoutRelationshipId:
          typeof item.layoutRelationshipId === "string"
            ? item.layoutRelationshipId
            : undefined,
        layoutPath:
          typeof item.layoutPath === "string" ? item.layoutPath : undefined,
        layoutName:
          typeof item.layoutName === "string" ? item.layoutName : undefined,
        layoutType:
          typeof item.layoutType === "string" ? item.layoutType : undefined,
        layoutThemePath:
          typeof item.layoutThemePath === "string"
            ? item.layoutThemePath
            : undefined,
        layoutThemeName:
          typeof item.layoutThemeName === "string"
            ? item.layoutThemeName
            : undefined,
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
        texts: texts.map((text, textIndex) => normalizePptxText(text, textIndex)),
        shapes: shapes
          .map((shape, shapeIndex): PptxShape | null => {
            const shapeItem = isRecord(shape) ? shape : {};
            const kind = normalizePptxShapeKind(shapeItem.kind);
            if (!kind) return null;
            return {
              id:
                typeof shapeItem.id === "string"
                  ? shapeItem.id
                  : `s${shapeIndex + 1}`,
              groupId: normalizePptxGroupId(shapeItem.groupId),
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
              lineStartArrow: normalizePptxLineArrow(shapeItem.lineStartArrow),
              lineEndArrow: normalizePptxLineArrow(shapeItem.lineEndArrow),
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
              groupId: normalizePptxGroupId(tableItem.groupId),
              textIndexStart: numericField(tableItem.textIndexStart),
              rows: normalizedRows,
              cellStyles: normalizePptxTableCellStyles(tableItem.cellStyles),
              columnWidths: normalizeNumberArray(tableItem.columnWidths),
              rowHeights: normalizeNumberArray(tableItem.rowHeights),
              x: numericField(tableItem.x),
              y: numericField(tableItem.y),
              width: numericField(tableItem.width),
              height: numericField(tableItem.height),
              rotation: numericField(tableItem.rotation),
              tableStyleId:
                typeof tableItem.tableStyleId === "string"
                  ? tableItem.tableStyleId
                  : undefined,
              firstRow:
                typeof tableItem.firstRow === "boolean"
                  ? tableItem.firstRow
                  : undefined,
              firstColumn:
                typeof tableItem.firstColumn === "boolean"
                  ? tableItem.firstColumn
                  : undefined,
              lastRow:
                typeof tableItem.lastRow === "boolean"
                  ? tableItem.lastRow
                  : undefined,
              lastColumn:
                typeof tableItem.lastColumn === "boolean"
                  ? tableItem.lastColumn
                  : undefined,
              bandedRows:
                typeof tableItem.bandedRows === "boolean"
                  ? tableItem.bandedRows
                  : undefined,
              bandedColumns:
                typeof tableItem.bandedColumns === "boolean"
                  ? tableItem.bandedColumns
                  : undefined,
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
              groupId: normalizePptxGroupId(imageItem.groupId),
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
              imageCropLeft: numericField(imageItem.imageCropLeft),
              imageCropTop: numericField(imageItem.imageCropTop),
              imageCropRight: numericField(imageItem.imageCropRight),
              imageCropBottom: numericField(imageItem.imageCropBottom),
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
        media: media
          .map((mediaItem, mediaIndex): PptxMedia | null => {
            const item = isRecord(mediaItem) ? mediaItem : {};
            if (!item.relationshipId && !item.mediaPath && !item.shapeId) return null;
            return {
              id:
                typeof item.id === "string"
                  ? item.id
                  : `media${mediaIndex + 1}`,
              kind:
                item.kind === "audio" || item.kind === "video"
                  ? item.kind
                  : undefined,
              relationshipId:
                typeof item.relationshipId === "string"
                  ? item.relationshipId
                  : undefined,
              mediaPath:
                typeof item.mediaPath === "string" ? item.mediaPath : undefined,
              mimeType:
                typeof item.mimeType === "string" ? item.mimeType : undefined,
              shapeId: typeof item.shapeId === "string" ? item.shapeId : undefined,
              name: typeof item.name === "string" ? item.name : undefined,
              description:
                typeof item.description === "string" ? item.description : undefined,
              x: numericField(item.x),
              y: numericField(item.y),
              width: numericField(item.width),
              height: numericField(item.height),
              rotation: numericField(item.rotation),
              timingIndex: numericField(item.timingIndex),
              volumePercent: numericField(item.volumePercent),
              muted: typeof item.muted === "boolean" ? item.muted : undefined,
              showWhenStopped:
                typeof item.showWhenStopped === "boolean"
                  ? item.showWhenStopped
                  : undefined,
              delayMs: numericField(item.delayMs),
              durationMs: numericField(item.durationMs),
            };
          })
          .filter((item): item is PptxMedia => item !== null),
        charts: charts
          .map((chart, chartIndex): PptxChart | null => {
            const chartItem = isRecord(chart) ? chart : {};
            return {
              id:
                typeof chartItem.id === "string"
                  ? chartItem.id
                  : `chart${chartIndex + 1}`,
              groupId: normalizePptxGroupId(chartItem.groupId),
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
              legendVisible:
                typeof chartItem.legendVisible === "boolean"
                  ? chartItem.legendVisible
                  : undefined,
              legendPosition:
                chartItem.legendPosition === "r" ||
                chartItem.legendPosition === "l" ||
                chartItem.legendPosition === "t" ||
                chartItem.legendPosition === "b" ||
                chartItem.legendPosition === "tr"
                  ? chartItem.legendPosition
                  : undefined,
              categoryAxisTitle:
                typeof chartItem.categoryAxisTitle === "string"
                  ? chartItem.categoryAxisTitle
                  : undefined,
              valueAxisTitle:
                typeof chartItem.valueAxisTitle === "string"
                  ? chartItem.valueAxisTitle
                  : undefined,
              categoryAxisPosition:
                chartItem.categoryAxisPosition === "b" ||
                chartItem.categoryAxisPosition === "t"
                  ? chartItem.categoryAxisPosition
                  : undefined,
              valueAxisPosition:
                chartItem.valueAxisPosition === "l" ||
                chartItem.valueAxisPosition === "r"
                  ? chartItem.valueAxisPosition
                  : undefined,
              categoryMajorGridlines:
                typeof chartItem.categoryMajorGridlines === "boolean"
                  ? chartItem.categoryMajorGridlines
                  : undefined,
              valueMajorGridlines:
                typeof chartItem.valueMajorGridlines === "boolean"
                  ? chartItem.valueMajorGridlines
                  : undefined,
              categoryAxisTickLabelPosition:
                normalizePptxAxisTickLabelPosition(
                  chartItem.categoryAxisTickLabelPosition,
                ),
              valueAxisTickLabelPosition: normalizePptxAxisTickLabelPosition(
                chartItem.valueAxisTickLabelPosition,
              ),
              categoryAxisMajorTickMark: normalizePptxAxisTickMark(
                chartItem.categoryAxisMajorTickMark,
              ),
              valueAxisMajorTickMark: normalizePptxAxisTickMark(
                chartItem.valueAxisMajorTickMark,
              ),
              categoryAxisMinorTickMark: normalizePptxAxisTickMark(
                chartItem.categoryAxisMinorTickMark,
              ),
              valueAxisMinorTickMark: normalizePptxAxisTickMark(
                chartItem.valueAxisMinorTickMark,
              ),
              categoryAxisNumberFormat: normalizePptxAxisNumberFormat(
                chartItem.categoryAxisNumberFormat,
              ),
              valueAxisNumberFormat: normalizePptxAxisNumberFormat(
                chartItem.valueAxisNumberFormat,
              ),
              categoryAxisLineColor: hexColorField(
                chartItem.categoryAxisLineColor,
              ),
              valueAxisLineColor: hexColorField(chartItem.valueAxisLineColor),
              categoryAxisLineWidth: normalizePptxAxisLineWidth(
                chartItem.categoryAxisLineWidth,
              ),
              valueAxisLineWidth: normalizePptxAxisLineWidth(
                chartItem.valueAxisLineWidth,
              ),
              categoryAxisLineDash: normalizePptxAxisLineDash(
                chartItem.categoryAxisLineDash,
              ),
              valueAxisLineDash: normalizePptxAxisLineDash(
                chartItem.valueAxisLineDash,
              ),
              categoryAxisLabelTextColor: hexColorField(
                chartItem.categoryAxisLabelTextColor,
              ),
              valueAxisLabelTextColor: hexColorField(
                chartItem.valueAxisLabelTextColor,
              ),
              categoryAxisLabelFontSize: normalizePptxAxisLabelFontSize(
                chartItem.categoryAxisLabelFontSize,
              ),
              valueAxisLabelFontSize: normalizePptxAxisLabelFontSize(
                chartItem.valueAxisLabelFontSize,
              ),
              categoryAxisLabelRotation: normalizePptxAxisLabelRotation(
                chartItem.categoryAxisLabelRotation,
              ),
              valueAxisLabelRotation: normalizePptxAxisLabelRotation(
                chartItem.valueAxisLabelRotation,
              ),
              categoryAxisLabelBold:
                typeof chartItem.categoryAxisLabelBold === "boolean"
                  ? chartItem.categoryAxisLabelBold
                  : undefined,
              valueAxisLabelBold:
                typeof chartItem.valueAxisLabelBold === "boolean"
                  ? chartItem.valueAxisLabelBold
                  : undefined,
              categoryAxisLabelItalic:
                typeof chartItem.categoryAxisLabelItalic === "boolean"
                  ? chartItem.categoryAxisLabelItalic
                  : undefined,
              valueAxisLabelItalic:
                typeof chartItem.valueAxisLabelItalic === "boolean"
                  ? chartItem.valueAxisLabelItalic
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

function normalizePptxLineArrow(value: unknown) {
  return value === "diamond" ||
    value === "none" ||
    value === "oval" ||
    value === "stealth" ||
    value === "triangle"
    ? value
    : undefined;
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
