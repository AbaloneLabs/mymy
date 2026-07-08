import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";
import { PptxReadOnlySlide } from "./pptxEditorPanels";

export function PptxPresentationOverlay({
  slides,
  presentingIndex,
  presentingSlide,
  onMove,
  onClose,
  onKeyDown,
}: {
  slides: PptxSlide[];
  presentingIndex: number;
  presentingSlide: PptxSlide;
  onMove: (direction: -1 | 1) => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      autoFocus
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4 text-xs text-white/70">
        <span>
          {presentingIndex + 1} / {slides.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={presentingIndex <= 0}
            className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={presentingIndex >= slides.length - 1}
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
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <PptxReadOnlySlide slide={presentingSlide} />
      </div>
    </div>
  );
}

export function PptxSlideNavigator({
  slides,
  activeSlideId,
  slideLabel,
  onSelect,
}: {
  slides: PptxSlide[];
  activeSlideId?: string;
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
          <span className="mt-2 block aspect-video rounded-sm bg-white p-1 text-[8px] leading-tight text-neutral-700 shadow-inner">
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
