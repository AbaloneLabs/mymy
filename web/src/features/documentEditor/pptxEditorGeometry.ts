import {
  PPTX_SNAP_GRID_PERCENT,
  PPTX_SNAP_THRESHOLD_PERCENT,
  clampPercent,
  snapPptxPercent,
} from "./pptxEditorUtils";
import type { PptxSnapGuide } from "./pptxEditorUtils";
import { pptxSelectionKey } from "./pptxSelection";
import type { PptxObjectRecord, PptxSelectionKey } from "./pptxSelection";

export type PptxBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PptxSnapTargetMap = {
  vertical: number[];
  horizontal: number[];
};

type PptxSnapDelta = {
  deltaX: number;
  deltaY: number;
  guides: PptxSnapGuide[];
};

export function pptxObjectBounds(object: PptxObjectRecord["object"]): PptxBounds {
  return {
    x: object.x ?? 0,
    y: object.y ?? 0,
    width: Math.max(object.width ?? 1, 0),
    height: Math.max(object.height ?? 1, 0),
  };
}

export function pptxObjectContainsPoint(
  record: PptxObjectRecord,
  point: { x: number; y: number },
) {
  const bounds = pptxObjectBounds(record.object);
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + Math.max(bounds.width, 1) &&
    point.y >= bounds.y &&
    point.y <= bounds.y + Math.max(bounds.height, 1)
  );
}

export function insertPptxDimensionValue(
  values: number[] | undefined,
  currentCount: number,
  afterIndex: number,
) {
  const fallback = 100 / Math.max(currentCount, 1);
  const next =
    values && values.length === currentCount
      ? [...values]
      : Array.from({ length: currentCount }, () => fallback);
  next.splice(afterIndex + 1, 0, next[afterIndex] ?? fallback);
  return next;
}

export function pptxBoundsFromItems(items: PptxBounds[]): PptxBounds | null {
  if (items.length === 0) return null;
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function pptxSnapTargets(
  records: PptxObjectRecord[],
  ignoredKeys: ReadonlySet<PptxSelectionKey>,
): PptxSnapTargetMap {
  const vertical = [0, 50, 100];
  const horizontal = [0, 50, 100];
  records.forEach((record) => {
    if (ignoredKeys.has(pptxSelectionKey(record.objectKind, record.objectId))) {
      return;
    }
    const bounds = pptxObjectBounds(record.object);
    vertical.push(bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width);
    horizontal.push(bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height);
  });
  return {
    vertical: uniquePptxSnapTargets(vertical),
    horizontal: uniquePptxSnapTargets(horizontal),
  };
}

export function pptxMoveSnap(
  bounds: PptxBounds,
  targets: PptxSnapTargetMap,
): PptxSnapDelta {
  const verticalSnap = nearestPptxSnap(
    [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
    targets.vertical,
  );
  const horizontalSnap = nearestPptxSnap(
    [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
    targets.horizontal,
  );
  const gridDeltaX =
    snapPptxPercent(bounds.x, PPTX_SNAP_GRID_PERCENT) - bounds.x;
  const gridDeltaY =
    snapPptxPercent(bounds.y, PPTX_SNAP_GRID_PERCENT) - bounds.y;
  const guides: PptxSnapGuide[] = [];
  if (verticalSnap) {
    guides.push({ orientation: "vertical", position: verticalSnap.position });
  }
  if (horizontalSnap) {
    guides.push({ orientation: "horizontal", position: horizontalSnap.position });
  }
  return {
    deltaX: verticalSnap?.delta ?? gridDeltaX,
    deltaY: horizontalSnap?.delta ?? gridDeltaY,
    guides,
  };
}

export function pptxResizeSnap(
  bounds: PptxBounds,
  targets: PptxSnapTargetMap,
  minHeight: number,
  ratio?: number,
  horizontalIntent = true,
): { width: number; height: number; guides: PptxSnapGuide[] } {
  const rightSnap = nearestPptxSnap([bounds.x + bounds.width], targets.vertical);
  const bottomSnap = nearestPptxSnap([bounds.y + bounds.height], targets.horizontal);
  const guides: PptxSnapGuide[] = [];
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    if (horizontalIntent) {
      const nextRight =
        rightSnap?.position ??
        snapPptxPercent(bounds.x + bounds.width, PPTX_SNAP_GRID_PERCENT);
      if (rightSnap) {
        guides.push({ orientation: "vertical", position: rightSnap.position });
      }
      const width = clampPercent(nextRight - bounds.x, 4, 100);
      return {
        width,
        height: clampPercent(width / ratio, minHeight, 100),
        guides,
      };
    }
    const nextBottom =
      bottomSnap?.position ??
      snapPptxPercent(bounds.y + bounds.height, PPTX_SNAP_GRID_PERCENT);
    if (bottomSnap) {
      guides.push({ orientation: "horizontal", position: bottomSnap.position });
    }
    const height = clampPercent(nextBottom - bounds.y, minHeight, 100);
    return {
      width: clampPercent(height * ratio, 4, 100),
      height,
      guides,
    };
  }

  if (rightSnap) {
    guides.push({ orientation: "vertical", position: rightSnap.position });
  }
  if (bottomSnap) {
    guides.push({ orientation: "horizontal", position: bottomSnap.position });
  }
  const width = clampPercent(
    (rightSnap?.position ??
      snapPptxPercent(bounds.x + bounds.width, PPTX_SNAP_GRID_PERCENT)) - bounds.x,
    4,
    100,
  );
  const height = clampPercent(
    (bottomSnap?.position ??
      snapPptxPercent(bounds.y + bounds.height, PPTX_SNAP_GRID_PERCENT)) - bounds.y,
    minHeight,
    100,
  );
  return { width, height, guides };
}

function uniquePptxSnapTargets(values: number[]) {
  return Array.from(
    new Set(
      values
        .filter(Number.isFinite)
        .map((value) => Number(value.toFixed(3))),
    ),
  );
}

function nearestPptxSnap(
  candidates: number[],
  targets: number[],
): { delta: number; position: number } | null {
  let nearest: { delta: number; position: number; distance: number } | null = null;
  for (const candidate of candidates) {
    for (const target of targets) {
      const distance = Math.abs(target - candidate);
      if (
        distance <= PPTX_SNAP_THRESHOLD_PERCENT &&
        (!nearest || distance < nearest.distance)
      ) {
        nearest = {
          delta: target - candidate,
          position: target,
          distance,
        };
      }
    }
  }
  return nearest ? { delta: nearest.delta, position: nearest.position } : null;
}
