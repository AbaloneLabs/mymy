import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";
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
  Pick<PptxObject, "x" | "y" | "width" | "height" | "rotation">
>;
export type PptxSelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
};

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
