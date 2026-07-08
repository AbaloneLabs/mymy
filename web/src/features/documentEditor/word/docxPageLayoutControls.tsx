import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DocxPageSettings } from "../shared/models";
import {
  DOCX_PAGE_PRESETS,
  TWIPS_PER_INCH,
  inchesToTwips,
  twipsToCssPixels,
  twipsToInches,
} from "./docxEditorUtils";

export function DocxRuler({
  page,
  onChange,
}: {
  page: DocxPageSettings | undefined;
  onChange: (patch: Partial<DocxPageSettings>) => void;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const pageWidth = twipsToCssPixels(page?.width ?? DOCX_PAGE_PRESETS[0].width);
  const marginLeft = page?.marginLeft ?? TWIPS_PER_INCH;
  const marginRight = page?.marginRight ?? TWIPS_PER_INCH;
  const leftPercent = Math.min(100, Math.max(0, (marginLeft / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const rightPercent = Math.min(100, Math.max(0, 100 - (marginRight / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const ticks = Array.from({ length: Math.ceil(twipsToInches(page?.width ?? DOCX_PAGE_PRESETS[0].width)) + 1 }, (_, index) => index);

  function updateMarginFromPointer(
    event: ReactPointerEvent<HTMLButtonElement>,
    side: "left" | "right",
  ) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const pageWidthTwips = page?.width ?? DOCX_PAGE_PRESETS[0].width;
    const next = Math.round((x / rect.width) * pageWidthTwips);
    if (side === "left") {
      onChange({ marginLeft: Math.min(next, pageWidthTwips - marginRight - 720) });
    } else {
      onChange({ marginRight: Math.min(pageWidthTwips - next, pageWidthTwips - marginLeft - 720) });
    }
  }

  function startDrag(side: "left" | "right", event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMarginFromPointer(event, side);
  }

  return (
    <div
      ref={rulerRef}
      className="relative mx-auto mb-3 h-8 max-w-full border border-[var(--border)] bg-[var(--bg)] text-[10px] text-[var(--text-faint)]"
      style={{ width: pageWidth }}
    >
      <div
        className="absolute inset-y-0 bg-[var(--surface-muted)]"
        style={{ left: `${leftPercent}%`, right: `${100 - rightPercent}%` }}
      />
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute bottom-0 top-0 border-l border-[var(--border)]"
          style={{ left: `${(tick / Math.max(1, ticks.length - 1)) * 100}%` }}
        >
          <span className="absolute left-1 top-0.5">{tick}</span>
        </div>
      ))}
      <button
        type="button"
        onPointerDown={(event) => startDrag("left", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "left");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${leftPercent}%` }}
        title="Left margin"
      />
      <button
        type="button"
        onPointerDown={(event) => startDrag("right", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "right");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${rightPercent}%` }}
        title="Right margin"
      />
    </div>
  );
}

export function DocxMarginInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      {label}
      <input
        type="number"
        min={0}
        max={4}
        step={0.1}
        value={twipsToInches(value ?? TWIPS_PER_INCH)}
        onChange={(event) => onChange(inchesToTwips(Number(event.target.value)))}
        className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
      />
    </label>
  );
}
