import type { DragEvent as ReactDragEvent } from "react";
import { cn } from "@/lib/utils";
import { isRecord } from "./models";
import type { JsonPathSegment } from "./textJsonUtils";

export function toolbarTextButtonClass(active: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
    active &&
      "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]",
  );
}

export function startJsonDataDrag(
  event: ReactDragEvent<HTMLButtonElement>,
  payload: string,
) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", payload);
}

export function jsonPathKey(path: JsonPathSegment[]) {
  return JSON.stringify(path);
}

export function isJsonContainer(value: unknown) {
  return Array.isArray(value) || isRecord(value);
}
