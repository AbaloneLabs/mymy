import type { CSSProperties } from "react";
import type {
  PptxAnimation,
  PptxChart,
  PptxImage,
  PptxModel,
  PptxShape,
  PptxShapeKind,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";

/**
 * PPTX editing represents slide objects as percentage-based geometry. These
 * helpers keep id allocation, object styles, drag resizing, and presentation
 * navigation deterministic and separate from the React canvas implementation.
 */
export interface SlideDragState {
  objectKind: "text" | "shape" | "image" | "table" | "chart";
  objectId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  rect: DOMRect;
  groupItems?: Array<{
    objectKind: "text" | "shape" | "image" | "table" | "chart";
    objectId: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>;
}

export type PptxSnapGuide = {
  orientation: "vertical" | "horizontal";
  position: number;
};

export const SLIDE_ASPECT_RATIO = 16 / 9;
export const PPTX_SNAP_GRID_PERCENT = 1;
export const PPTX_SNAP_THRESHOLD_PERCENT = 1;

export function isPptxLineShapeKind(kind?: PptxShapeKind) {
  return kind === "line" || kind === "straightConnector1";
}

export function isPptxLineShape(shape?: Pick<PptxShape, "kind">) {
  return isPptxLineShapeKind(shape?.kind);
}

export function pptxSlideBackgroundStyle(slide?: PptxSlide): CSSProperties {
  if (!slide) return { backgroundColor: "#ffffff" };
  if (
    slide.backgroundKind === "gradient" &&
    slide.backgroundGradientStart &&
    slide.backgroundGradientEnd
  ) {
    const angle = Number.isFinite(slide.backgroundGradientAngle)
      ? slide.backgroundGradientAngle
      : 90;
    return {
      backgroundColor: slide.backgroundGradientStart,
      backgroundImage: `linear-gradient(${angle}deg, ${slide.backgroundGradientStart}, ${slide.backgroundGradientEnd})`,
    };
  }
  if (slide.backgroundKind === "image" && slide.backgroundImageDataUrl) {
    return {
      backgroundColor: slide.backgroundColor ?? "#ffffff",
      backgroundImage: `url("${slide.backgroundImageDataUrl}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
    };
  }
  return { backgroundColor: slide.backgroundColor ?? "#ffffff" };
}

export function animationLabel(animation: PptxAnimation) {
  if (animation.presetClass || animation.presetId) {
    return [animation.presetClass, animation.presetId].filter(Boolean).join(" ");
  }
  return animation.nodeType ?? animation.id;
}

export function nextPptxSlidePath(model: PptxModel) {
  const used = new Set(model.slides.map((slide) => slide.id));
  const numbers = model.slides
    .map((slide) => /ppt\/slides\/slide(\d+)\.xml$/i.exec(slide.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value));
  let number = Math.max(0, ...numbers) + 1;
  while (used.has(`ppt/slides/slide${number}.xml`)) number += 1;
  return `ppt/slides/slide${number}.xml`;
}

export function nextPptxTextId(texts: PptxText[], seed = texts.length + 1) {
  const used = new Set(texts.map((text) => text.id));
  let index = Math.max(1, seed);
  let id = `t${index}`;
  while (used.has(id)) {
    index += 1;
    id = `t${index}`;
  }
  return id;
}

export function nextPptxShapeId(shapes: PptxShape[], seed = shapes.length + 1) {
  const used = new Set(shapes.map((shape) => shape.id));
  let index = Math.max(1, seed);
  let id = `s${index}`;
  while (used.has(id)) {
    index += 1;
    id = `s${index}`;
  }
  return id;
}

export function nextPptxTableId(tables: PptxTable[], seed = tables.length + 1) {
  const used = new Set(tables.map((table) => table.id));
  let index = Math.max(1, seed);
  let id = `tbl${index}`;
  while (used.has(id)) {
    index += 1;
    id = `tbl${index}`;
  }
  return id;
}

export function nextPptxImageId(images: PptxImage[], seed = images.length + 1) {
  const used = new Set(images.map((image) => image.id));
  let index = Math.max(1, seed);
  let id = `img${index}`;
  while (used.has(id)) {
    index += 1;
    id = `img${index}`;
  }
  return id;
}

export function nextPptxChartId(charts: PptxChart[], seed = charts.length + 1) {
  const used = new Set(charts.map((chart) => chart.id));
  let index = Math.max(1, seed);
  let id = `chart${index}`;
  while (used.has(id)) {
    index += 1;
    id = `chart${index}`;
  }
  return id;
}

export function nextPptxGroupId(slide: PptxSlide) {
  const used = new Set(
    [
      ...slide.texts,
      ...(slide.shapes ?? []),
      ...(slide.images ?? []),
      ...(slide.tables ?? []),
      ...(slide.charts ?? []),
    ]
      .map((object) => object.groupId)
      .filter((groupId): groupId is string => Boolean(groupId)),
  );
  let index = used.size + 1;
  let id = `group${index}`;
  while (used.has(id)) {
    index += 1;
    id = `group${index}`;
  }
  return id;
}

export function pptxImageStyle(image: PptxImage, zIndex: number): CSSProperties {
  return {
    left: `${image.x ?? 20}%`,
    top: `${image.y ?? 20}%`,
    width: `${image.width ?? 32}%`,
    height: `${image.height ?? 32}%`,
    transform: `rotate(${image.rotation ?? 0}deg)`,
    zIndex,
  };
}

export function pptxChartStyle(chart: PptxChart, zIndex: number): CSSProperties {
  return {
    left: `${chart.x ?? 18}%`,
    top: `${chart.y ?? 18}%`,
    width: `${chart.width ?? 58}%`,
    height: `${chart.height ?? 44}%`,
    transform: `rotate(${chart.rotation ?? 0}deg)`,
    zIndex,
  };
}

export function pptxTableStyle(table: PptxTable, zIndex: number): CSSProperties {
  return {
    left: `${table.x ?? 14}%`,
    top: `${table.y ?? 28}%`,
    width: `${table.width ?? 60}%`,
    height: `${table.height ?? 28}%`,
    transform: `rotate(${table.rotation ?? 0}deg)`,
    zIndex,
  };
}

export function lockedAspectResize(
  dragState: SlideDragState,
  deltaX: number,
  deltaY: number,
  minHeight: number,
) {
  const ratio = dragState.startWidth / Math.max(dragState.startHeight, 1);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      width: clampPercent(dragState.startWidth + deltaX, 4, 100),
      height: clampPercent(dragState.startHeight + deltaY, minHeight, 100),
    };
  }
  const horizontalIntent = Math.abs(deltaX) >= Math.abs(deltaY);
  if (horizontalIntent) {
    const width = clampPercent(dragState.startWidth + deltaX, 4, 100);
    return {
      width,
      height: clampPercent(width / ratio, minHeight, 100),
    };
  }
  const height = clampPercent(dragState.startHeight + deltaY, minHeight, 100);
  return {
    width: clampPercent(height * ratio, 4, 100),
    height,
  };
}

export function clampPercent(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function snapPptxPercent(value: number, step = PPTX_SNAP_GRID_PERCENT) {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function normalizeRotation(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function firstVisibleSlideIndex(slides: PptxSlide[]) {
  const index = slides.findIndex((slide) => !slide.hidden);
  return index >= 0 ? index : 0;
}

export function nextVisibleSlideIndex(
  slides: PptxSlide[],
  startIndex: number,
  direction: -1 | 1,
  allowHiddenStart = false,
) {
  if (slides.length === 0) return 0;
  let index = Math.min(slides.length - 1, Math.max(0, startIndex));
  if (allowHiddenStart && !slides[index]?.hidden) return index;
  while (index >= 0 && index < slides.length) {
    if (!slides[index]?.hidden) return index;
    index += direction;
  }
  return firstVisibleSlideIndex(slides);
}

export function reorderPptxObjectsById<T extends { id: string }>(
  items: T[],
  id: string,
  direction: -1 | 1,
) {
  const index = items.findIndex((item) => item.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}
