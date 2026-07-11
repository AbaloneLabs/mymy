import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";
import type { SlideDragState } from "./pptxEditorUtils";

export type PptxObjectKind = SlideDragState["objectKind"];
export type PptxObject =
  | PptxText
  | PptxShape
  | PptxImage
  | PptxTable
  | PptxChart;
export type PptxSelectionKey = `${PptxObjectKind}:${string}`;
export type PptxObjectRecord = {
  objectKind: PptxObjectKind;
  objectId: string;
  object: PptxObject;
};
export type PptxGeometryPatch = Partial<
  Pick<
    PptxObject,
    "x" | "y" | "width" | "height" | "rotation" | "groupId" | "groupShapeId"
  >
>;
export type PptxSelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  startSelectedObjectKeys: PptxSelectionKey[];
  startActiveObjectKey: PptxSelectionKey | null;
};

export function restoredPptxSelection(
  slide: PptxSlide | undefined,
  selectedKeys: PptxSelectionKey[],
  activeKey: PptxSelectionKey | null,
) {
  const available = new Set(
    slide
      ? pptxSlideObjectRecords(slide).map((record) =>
          pptxSelectionKey(record.objectKind, record.objectId),
        )
      : [],
  );
  const nextSelectedKeys = selectedKeys.filter((key) => available.has(key));
  const nextActiveKey =
    activeKey && available.has(activeKey)
      ? activeKey
      : (nextSelectedKeys.at(-1) ?? null);
  return { selectedKeys: nextSelectedKeys, activeKey: nextActiveKey };
}

export function pptxSelectionKey(
  objectKind: PptxObjectKind,
  objectId: string,
): PptxSelectionKey {
  return `${objectKind}:${objectId}` as PptxSelectionKey;
}

export function parsePptxSelectionKey(key: PptxSelectionKey) {
  const separatorIndex = key.indexOf(":");
  return {
    objectKind: key.slice(0, separatorIndex) as PptxObjectKind,
    objectId: key.slice(separatorIndex + 1),
  };
}

export function pptxSlideObjectRecords(slide: PptxSlide): PptxObjectRecord[] {
  return [
    ...slide.texts.map((object) => ({
      objectKind: "text" as const,
      objectId: object.id,
      object,
    })),
    ...(slide.shapes ?? []).map((object) => ({
      objectKind: "shape" as const,
      objectId: object.id,
      object,
    })),
    ...(slide.images ?? []).map((object) => ({
      objectKind: "image" as const,
      objectId: object.id,
      object,
    })),
    ...(slide.tables ?? []).map((object) => ({
      objectKind: "table" as const,
      objectId: object.id,
      object,
    })),
    ...(slide.charts ?? []).map((object) => ({
      objectKind: "chart" as const,
      objectId: object.id,
      object,
    })),
  ];
}

export function derivePptxEditorSelection({
  slide,
  activeTextId,
  activeShapeId,
  activeImageId,
  activeTableId,
  activeChartId,
  selectedObjectKeys,
}: {
  slide: PptxSlide | undefined;
  activeTextId: string | null;
  activeShapeId: string | null;
  activeImageId: string | null;
  activeTableId: string | null;
  activeChartId: string | null;
  selectedObjectKeys: PptxSelectionKey[];
}) {
  const activeText = slide?.texts.find((item) => item.id === activeTextId);
  const activeShape = slide?.shapes?.find((item) => item.id === activeShapeId);
  const activeImage = slide?.images?.find((item) => item.id === activeImageId);
  const activeTable = slide?.tables?.find((item) => item.id === activeTableId);
  const activeChart = slide?.charts?.find((item) => item.id === activeChartId);
  const activeTextIndex = slide?.texts.findIndex((item) => item.id === activeTextId) ?? -1;
  const activeShapeIndex =
    slide?.shapes?.findIndex((item) => item.id === activeShapeId) ?? -1;
  const activeImageIndex =
    slide?.images?.findIndex((item) => item.id === activeImageId) ?? -1;
  const activeTableIndex =
    slide?.tables?.findIndex((item) => item.id === activeTableId) ?? -1;
  const activeChartIndex =
    slide?.charts?.findIndex((item) => item.id === activeChartId) ?? -1;
  const activeObject =
    activeText ?? activeShape ?? activeImage ?? activeTable ?? activeChart;
  const activeLayerIndex = activeText
    ? activeTextIndex
    : activeShape
      ? activeShapeIndex
      : activeImage
        ? activeImageIndex
        : activeTable
          ? activeTableIndex
          : activeChart
            ? activeChartIndex
            : -1;
  const activeLayerLength = activeText
    ? (slide?.texts.length ?? 0)
    : activeShape
      ? (slide?.shapes?.length ?? 0)
      : activeImage
        ? (slide?.images?.length ?? 0)
        : activeTable
          ? (slide?.tables?.length ?? 0)
          : activeChart
            ? (slide?.charts?.length ?? 0)
            : 0;
  const selectedObjectKeySet = new Set(selectedObjectKeys);
  const selectedObjects = slide
    ? pptxSlideObjectRecords(slide).filter((record) =>
        selectedObjectKeySet.has(
          pptxSelectionKey(record.objectKind, record.objectId),
        ),
      )
    : [];
  const activeObjectKey = activeText
    ? pptxSelectionKey("text", activeText.id)
    : activeShape
      ? pptxSelectionKey("shape", activeShape.id)
      : activeImage
        ? pptxSelectionKey("image", activeImage.id)
        : activeTable
          ? pptxSelectionKey("table", activeTable.id)
          : activeChart
            ? pptxSelectionKey("chart", activeChart.id)
            : null;

  return {
    activeChart,
    activeImage,
    activeLayerIndex,
    activeLayerLength,
    activeObject,
    activeObjectKey,
    activeShape,
    activeTable,
    activeText,
    hasGroupedSelection: selectedObjects.some((record) => record.object.groupId),
    hasMultiSelection: selectedObjects.length > 1,
    hasObjectSelection: selectedObjects.length > 0,
    selectedObjectKeySet,
    selectedObjects,
  };
}

export function patchPptxSlideObjects(
  slide: PptxSlide,
  patches: Map<PptxSelectionKey, PptxGeometryPatch>,
): PptxSlide {
  return {
    ...slide,
    texts: slide.texts.map((object) => ({
      ...object,
      ...patches.get(pptxSelectionKey("text", object.id)),
    })),
    shapes: (slide.shapes ?? []).map((object) => ({
      ...object,
      ...patches.get(pptxSelectionKey("shape", object.id)),
    })),
    images: (slide.images ?? []).map((object) => ({
      ...object,
      ...patches.get(pptxSelectionKey("image", object.id)),
    })),
    tables: (slide.tables ?? []).map((object) => ({
      ...object,
      ...patches.get(pptxSelectionKey("table", object.id)),
    })),
    charts: (slide.charts ?? []).map((object) => ({
      ...object,
      ...patches.get(pptxSelectionKey("chart", object.id)),
    })),
  };
}

export function pptxSelectionBounds(records: PptxObjectRecord[]) {
  const left = Math.min(...records.map((record) => record.object.x ?? 0));
  const top = Math.min(...records.map((record) => record.object.y ?? 0));
  const right = Math.max(
    ...records.map(
      (record) => (record.object.x ?? 0) + (record.object.width ?? 0),
    ),
  );
  const bottom = Math.max(
    ...records.map(
      (record) => (record.object.y ?? 0) + (record.object.height ?? 0),
    ),
  );
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function pptxSelectionBoxBounds(box: PptxSelectionBox) {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const right = Math.max(box.startX, box.currentX);
  const bottom = Math.max(box.startY, box.currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function pptxObjectIntersectsSelectionBox(
  record: PptxObjectRecord,
  box: ReturnType<typeof pptxSelectionBoxBounds>,
) {
  const x = record.object.x ?? 0;
  const y = record.object.y ?? 0;
  const width = Math.max(record.object.width ?? 1, 1);
  const height = Math.max(record.object.height ?? 1, 1);
  return (
    x <= box.right &&
    x + width >= box.left &&
    y <= box.bottom &&
    y + height >= box.top
  );
}
