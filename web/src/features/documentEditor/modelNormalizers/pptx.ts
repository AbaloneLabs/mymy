import type {
  PptxAnimation,
  PptxChart,
  PptxChartSeries,
  PptxImage,
  PptxModel,
  PptxShape,
  PptxTable,
  PptxTransition,
} from "../models";
import { isRecord, numericField } from "./shared";

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
