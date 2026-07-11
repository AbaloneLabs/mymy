import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";
import {
  nextPptxChartId,
  nextPptxGroupId,
  nextPptxImageId,
  nextPptxShapeId,
  nextPptxTableId,
  nextPptxTextId,
} from "./pptxEditorUtils";
import type { PptxObjectRecord, PptxSelectionKey } from "./pptxSelection";
import { pptxSelectionKey } from "./pptxSelection";

export function duplicatePptxSelectedObjects(
  slide: PptxSlide,
  selectedObjects: PptxObjectRecord[],
): { slide: PptxSlide; selectedKeys: PptxSelectionKey[] } {
  const selectedKeys: PptxSelectionKey[] = [];
  const texts = [...slide.texts];
  const shapes = [...(slide.shapes ?? [])];
  const images = [...(slide.images ?? [])];
  const tables = [...(slide.tables ?? [])];
  const charts = [...(slide.charts ?? [])];
  const duplicatedGroupIds = new Map<string, string>();

  function allocateDuplicateGroupId(sourceGroupId?: string) {
    if (!sourceGroupId) return undefined;
    const existing = duplicatedGroupIds.get(sourceGroupId);
    if (existing) return existing;
    const groupId = nextPptxGroupId({ ...slide, texts, shapes, images, tables, charts });
    duplicatedGroupIds.set(sourceGroupId, groupId);
    return groupId;
  }

  selectedObjects.forEach((record) => {
    if (record.objectKind === "text") {
      const source = record.object as PptxText;
      const next = {
        ...source,
        id: nextPptxTextId(texts),
        shapeId: undefined,
        groupShapeId: undefined,
        textIndex: undefined,
        groupId: allocateDuplicateGroupId(source.groupId),
        x: Math.min((source.x ?? 10) + 2, 100),
        y: Math.min((source.y ?? 12) + 2, 100),
      };
      texts.push(next);
      selectedKeys.push(pptxSelectionKey("text", next.id));
    } else if (record.objectKind === "shape") {
      const source = record.object as PptxShape;
      const next = {
        ...source,
        id: nextPptxShapeId(shapes),
        shapeId: undefined,
        groupShapeId: undefined,
        groupId: allocateDuplicateGroupId(source.groupId),
        x: Math.min((source.x ?? 24) + 2, 100),
        y: Math.min((source.y ?? 34) + 2, 100),
      };
      shapes.push(next);
      selectedKeys.push(pptxSelectionKey("shape", next.id));
    } else if (record.objectKind === "image") {
      const source = record.object as PptxImage;
      const next = {
        ...source,
        id: nextPptxImageId(images),
        shapeId: undefined,
        groupShapeId: undefined,
        groupId: allocateDuplicateGroupId(source.groupId),
        relationshipId: undefined,
        x: Math.min((source.x ?? 24) + 2, 100),
        y: Math.min((source.y ?? 34) + 2, 100),
      };
      images.push(next);
      selectedKeys.push(pptxSelectionKey("image", next.id));
    } else if (record.objectKind === "table") {
      const source = record.object as PptxTable;
      const next = {
        ...source,
        id: nextPptxTableId(tables),
        shapeId: undefined,
        groupShapeId: undefined,
        textIndexStart: undefined,
        groupId: allocateDuplicateGroupId(source.groupId),
        x: Math.min((source.x ?? 18) + 2, 100),
        y: Math.min((source.y ?? 30) + 2, 100),
        rows: source.rows.map((row) => [...row]),
      };
      tables.push(next);
      selectedKeys.push(pptxSelectionKey("table", next.id));
    } else {
      const source = record.object as PptxChart;
      const next = {
        ...source,
        id: nextPptxChartId(charts),
        shapeId: undefined,
        groupShapeId: undefined,
        groupId: allocateDuplicateGroupId(source.groupId),
        relationshipId: undefined,
        x: Math.min((source.x ?? 18) + 2, 100),
        y: Math.min((source.y ?? 18) + 2, 100),
        series: (source.series ?? []).map((series) => ({
          ...series,
          categories: series.categories ? [...series.categories] : undefined,
          values: series.values ? [...series.values] : undefined,
        })),
        categories: source.categories ? [...source.categories] : undefined,
      };
      charts.push(next);
      selectedKeys.push(pptxSelectionKey("chart", next.id));
    }
  });

  return {
    slide: {
      ...slide,
      texts,
      shapes,
      images,
      tables,
      charts,
    },
    selectedKeys,
  };
}
