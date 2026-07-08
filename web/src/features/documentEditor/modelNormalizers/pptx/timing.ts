import type { PptxAnimation, PptxTransition } from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizePptxAnimation(value: unknown): PptxAnimation | null {
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

export function normalizePptxTransition(value: unknown): PptxTransition | undefined {
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
