import { ChevronDown, ChevronUp } from "lucide-react";
import type { PptxAnimation, PptxMedia } from "../shared/models";
import { PptxAnimationTimeline } from "./pptxAnimationTimeline";
import { animationLabel } from "./pptxEditorUtils";

export function PptxAnimationInspector({
  animations,
  disabled,
  onTimingChange,
  onMove,
}: {
  animations: PptxAnimation[];
  disabled: boolean;
  onTimingChange: (
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) => void;
  onMove: (animationId: string, direction: -1 | 1) => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Animations
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {animations.length} timing nodes
        </span>
      </div>
      {animations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-faint)]">
          No slide animation timing
        </div>
      ) : (
        <div className="grid max-h-40 gap-1 overflow-auto">
          {animations.map((animation, index) => (
            <div
              key={`${animation.id}:${index}`}
              className="grid items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs md:grid-cols-[minmax(0,1fr)_5rem_5rem_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text)]">
                  {animationLabel(animation)}
                </div>
                <div className="truncate text-[11px] text-[var(--text-faint)]">
                  {[
                    animation.nodeType,
                    animation.presetClass,
                    animation.targetShapeId ? `target ${animation.targetShapeId}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <label className="grid gap-1 text-[11px] text-[var(--text-muted)]">
                <span>Delay</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  step={100}
                  value={animation.delayMs ?? 0}
                  onChange={(event) =>
                    onTimingChange(animation.id, {
                      delayMs: Math.max(0, Number(event.currentTarget.value) || 0),
                    })
                  }
                  disabled={disabled}
                  className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-[var(--text-muted)]">
                <span>Duration</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  step={100}
                  value={animation.durationMs ?? 0}
                  onChange={(event) =>
                    onTimingChange(animation.id, {
                      durationMs: Math.max(0, Number(event.currentTarget.value) || 0),
                    })
                  }
                  disabled={disabled}
                  className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
              </label>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => onMove(animation.id, -1)}
                  disabled={disabled || index === 0}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Move animation earlier"
                >
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(animation.id, 1)}
                  disabled={disabled || index >= animations.length - 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Move animation later"
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {animations.length > 0 && (
        <PptxAnimationTimeline
          animations={animations}
          disabled={disabled}
          onTimingChange={onTimingChange}
        />
      )}
    </div>
  );
}

export function PptxMediaInspector({
  media,
  disabled,
  onChange,
}: {
  media: PptxMedia[];
  disabled: boolean;
  onChange: (mediaId: string, patch: Partial<PptxMedia>) => void;
}) {
  if (media.length === 0) return null;
  return (
    <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] md:grid-cols-2">
      {media.map((item) => (
        <div
          key={item.id}
          className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[var(--text)]">
                {item.name || item.mediaPath || item.id}
              </div>
              <div className="truncate">
                {[item.kind, item.mimeType, item.shapeId && `shape ${item.shapeId}`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <label className="inline-flex items-center gap-1 text-xs text-[var(--text)]">
              <input
                type="checkbox"
                checked={Boolean(item.muted)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(item.id, { muted: event.currentTarget.checked })
                }
              />
              Mute
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Volume</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(item.volumePercent ?? 100)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(item.id, {
                    volumePercent: Math.max(
                      0,
                      Math.min(100, Number(event.currentTarget.value) || 0),
                    ),
                  })
                }
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Delay</span>
              <input
                type="number"
                min={0}
                max={600000}
                step={250}
                value={item.delayMs ?? 0}
                disabled={disabled}
                onChange={(event) =>
                  onChange(item.id, {
                    delayMs: Math.max(0, Number(event.currentTarget.value) || 0),
                  })
                }
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Duration</span>
              <input
                type="number"
                min={0}
                max={600000}
                step={250}
                value={item.durationMs ?? 0}
                disabled={disabled}
                onChange={(event) =>
                  onChange(item.id, {
                    durationMs: Math.max(0, Number(event.currentTarget.value) || 0),
                  })
                }
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="flex items-end gap-2 pb-1 text-xs text-[var(--text)]">
              <input
                type="checkbox"
                checked={item.showWhenStopped ?? true}
                disabled={disabled}
                onChange={(event) =>
                  onChange(item.id, {
                    showWhenStopped: event.currentTarget.checked,
                  })
                }
              />
              Show stopped
            </label>
          </div>
          {item.mediaPath && <div className="truncate">{item.mediaPath}</div>}
        </div>
      ))}
    </div>
  );
}
