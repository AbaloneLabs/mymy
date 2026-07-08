import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Layers, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";
import { PptxReadOnlySlide } from "./pptxReadOnlySlide";
import { adjacentVisibleSlideIndex } from "./pptxEditorUtils";

export function PptxPresentationOverlay({
  slides,
  presentingIndex,
  presentingSlide,
  slideAspectRatio,
  onMove,
  onClose,
  onKeyDown,
}: {
  slides: PptxSlide[];
  presentingIndex: number;
  presentingSlide: PptxSlide;
  slideAspectRatio: number;
  onMove: (direction: -1 | 1) => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [blankScreen, setBlankScreen] = useState<"black" | "white" | null>(null);
  const nextSlideIndex = useMemo(
    () => adjacentVisibleSlideIndex(slides, presentingIndex, 1),
    [slides, presentingIndex],
  );
  const previousSlideIndex = useMemo(
    () => adjacentVisibleSlideIndex(slides, presentingIndex, -1),
    [slides, presentingIndex],
  );
  const nextSlide = nextSlideIndex === null ? null : slides[nextSlideIndex];
  const notes = presentingSlide.notes?.trim() ?? "";
  const visibleSlideCount = slides.filter((slide) => !slide.hidden).length || slides.length;
  const currentVisiblePosition =
    slides.slice(0, presentingIndex + 1).filter((slide) => !slide.hidden).length || 1;
  const progress = Math.min(
    100,
    Math.max(0, (currentVisiblePosition / Math.max(1, visibleSlideCount)) * 100),
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  function handleOverlayKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      setBlankScreen((current) => (current === "black" ? null : "black"));
      return;
    }
    if (key === "w") {
      event.preventDefault();
      setBlankScreen((current) => (current === "white" ? null : "white"));
      return;
    }
    if (event.key === "Escape" && blankScreen) {
      event.preventDefault();
      setBlankScreen(null);
      return;
    }
    onKeyDown(event);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={handleOverlayKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      autoFocus
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4 text-xs text-white/70">
        <div className="flex items-center gap-3">
          <span>
            {presentingIndex + 1} / {slides.length}
          </span>
          <span>
            {currentVisiblePosition} / {visibleSlideCount} visible
          </span>
          <span>{formatPresenterElapsed(now - startedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setBlankScreen((current) => (current === "black" ? null : "black"))
            }
            title="Black screen"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/20 hover:bg-white/10",
              blankScreen === "black" && "border-white/60 bg-white/15",
            )}
          >
            <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() =>
              setBlankScreen((current) => (current === "white" ? null : "white"))
            }
            title="White screen"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/20 hover:bg-white/10",
              blankScreen === "white" && "border-white/60 bg-white/15",
            )}
          >
            <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={previousSlideIndex === null}
            className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={nextSlideIndex === null}
            className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
      <div className="h-1 shrink-0 bg-white/10">
        <div
          className="h-full bg-[var(--accent)]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-h-0 items-center justify-center">
          {blankScreen ? (
            <div
              className={cn(
                "w-full max-w-6xl shadow-2xl",
                blankScreen === "black" ? "bg-black" : "bg-white",
              )}
              style={{ aspectRatio: slideAspectRatio }}
            />
          ) : (
            <PptxReadOnlySlide
              slide={presentingSlide}
              slideAspectRatio={slideAspectRatio}
            />
          )}
        </div>
        <aside className="grid min-h-0 gap-3 overflow-hidden rounded-md border border-white/15 bg-white/[0.06] p-3 text-sm text-white/80">
          <section className="min-h-0 overflow-auto">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/45">
              Speaker notes
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">
              {notes || " "}
            </div>
          </section>
          <section className="grid gap-2 border-t border-white/10 pt-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">
              {nextSlideIndex === null ? "Next" : `Next · ${nextSlideIndex + 1}`}
            </div>
            {nextSlide ? (
              <div className="overflow-hidden rounded border border-white/10 bg-black/40">
                <PptxReadOnlySlide
                  slide={nextSlide}
                  slideAspectRatio={slideAspectRatio}
                />
              </div>
            ) : (
              <div className="h-24 rounded border border-white/10 bg-black/40" />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatPresenterElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function PptxSlideNavigator({
  slides,
  activeSlideId,
  slideAspectRatio,
  slideLabel,
  onSelect,
}: {
  slides: PptxSlide[];
  activeSlideId?: string;
  slideAspectRatio: number;
  slideLabel: (index: number) => string;
  onSelect: (slideId: string) => void;
}) {
  return (
    <div className="w-40 shrink-0 overflow-y-auto border-r border-[var(--border)] p-2">
      {slides.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            "mb-2 block w-full rounded-md border px-2 py-3 text-left text-xs",
            item.hidden && "opacity-55",
            item.id === activeSlideId
              ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
          )}
        >
          <span className="flex items-center justify-between gap-2">
            {slideLabel(index)}
            {item.hidden && (
              <span className="text-[10px] uppercase text-[var(--text-faint)]">
                hidden
              </span>
            )}
          </span>
          <span
            className="mt-2 block rounded-sm bg-white p-1 text-[8px] leading-tight text-neutral-700 shadow-inner"
            style={{ aspectRatio: slideAspectRatio }}
          >
            {[
              ...item.texts.slice(0, 2).map((text) => text.text),
              ...(item.shapes ?? []).slice(0, 2).map((shape) => shape.kind),
              ...(item.charts ?? []).slice(0, 1).map((chart) => chart.title ?? "Chart"),
            ].join(" / ")}
          </span>
        </button>
      ))}
    </div>
  );
}

type PptxLayerObjectKind = "text" | "shape" | "image" | "table" | "chart";

interface PptxLayerObjectRecord {
  objectKind: PptxLayerObjectKind;
  objectId: string;
  object: PptxText | PptxShape | PptxImage | PptxTable | PptxChart;
}

export function PptxObjectLayerPanel({
  slide,
  activeKey,
  selectedKeys,
  onSelect,
  onMove,
}: {
  slide: PptxSlide;
  activeKey: string | null;
  selectedKeys: Set<string>;
  onSelect: (
    objectKind: PptxLayerObjectKind,
    objectId: string,
    additive: boolean,
  ) => void;
  onMove: (
    objectKind: PptxLayerObjectKind,
    objectId: string,
    direction: -1 | 1,
  ) => void;
}) {
  const records = [...pptxSlideLayerRecords(slide)].reverse();
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
        Objects
      </div>
      {records.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
          Empty slide
        </div>
      ) : (
        <div className="grid gap-1">
          {records.map((record) => {
            const key = pptxLayerKey(record.objectKind, record.objectId);
            const selected = selectedKeys.has(key);
            const typeIndex = pptxLayerTypeIndex(slide, record);
            const typeLength = pptxLayerTypeLength(slide, record.objectKind);
            return (
              <div
                key={key}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1.5",
                  selected && "border-[var(--accent)] bg-[var(--surface-hover)]",
                  activeKey === key && "ring-1 ring-[var(--accent)]/40",
                )}
              >
                <button
                  type="button"
                  onClick={(event) =>
                    onSelect(
                      record.objectKind,
                      record.objectId,
                      event.shiftKey || event.metaKey || event.ctrlKey,
                    )
                  }
                  className="min-w-0 text-left"
                  title={pptxLayerLabel(record)}
                >
                  <span className="block truncate text-xs font-medium text-[var(--text)]">
                    {pptxLayerLabel(record)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[var(--text-faint)]">
                    {record.objectKind} · {record.objectId}
                  </span>
                </button>
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => onMove(record.objectKind, record.objectId, 1)}
                    disabled={typeIndex >= typeLength - 1}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="Bring forward"
                  >
                    <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(record.objectKind, record.objectId, -1)}
                    disabled={typeIndex <= 0}
                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="Send backward"
                  >
                    <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function pptxSlideLayerRecords(slide: PptxSlide): PptxLayerObjectRecord[] {
  return [
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
    ...(slide.charts ?? []).map((object) => ({
      objectKind: "chart" as const,
      objectId: object.id,
      object,
    })),
    ...(slide.tables ?? []).map((object) => ({
      objectKind: "table" as const,
      objectId: object.id,
      object,
    })),
    ...slide.texts.map((object) => ({
      objectKind: "text" as const,
      objectId: object.id,
      object,
    })),
  ];
}

function pptxLayerKey(objectKind: PptxLayerObjectKind, objectId: string) {
  return `${objectKind}:${objectId}`;
}

function pptxLayerLabel(record: PptxLayerObjectRecord) {
  if (record.objectKind === "text") {
    const text = (record.object as PptxText).text.trim();
    return text || "Text box";
  }
  if (record.objectKind === "shape") return (record.object as PptxShape).kind;
  if (record.objectKind === "image") {
    const image = record.object as PptxImage;
    return image.altText || image.mediaPath || "Image";
  }
  if (record.objectKind === "table") {
    const table = record.object as PptxTable;
    return `Table ${table.rows.length}x${Math.max(0, ...table.rows.map((row) => row.length))}`;
  }
  const chart = record.object as PptxChart;
  return chart.title || chart.type || "Chart";
}

function pptxLayerTypeIndex(slide: PptxSlide, record: PptxLayerObjectRecord) {
  if (record.objectKind === "text") {
    return slide.texts.findIndex((item) => item.id === record.objectId);
  }
  if (record.objectKind === "shape") {
    return (slide.shapes ?? []).findIndex((item) => item.id === record.objectId);
  }
  if (record.objectKind === "image") {
    return (slide.images ?? []).findIndex((item) => item.id === record.objectId);
  }
  if (record.objectKind === "table") {
    return (slide.tables ?? []).findIndex((item) => item.id === record.objectId);
  }
  return (slide.charts ?? []).findIndex((item) => item.id === record.objectId);
}

function pptxLayerTypeLength(slide: PptxSlide, objectKind: PptxLayerObjectKind) {
  if (objectKind === "text") return slide.texts.length;
  if (objectKind === "shape") return slide.shapes?.length ?? 0;
  if (objectKind === "image") return slide.images?.length ?? 0;
  if (objectKind === "table") return slide.tables?.length ?? 0;
  return slide.charts?.length ?? 0;
}
