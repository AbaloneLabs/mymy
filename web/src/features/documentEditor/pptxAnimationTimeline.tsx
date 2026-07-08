import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PptxAnimation } from "./models";
import { animationLabel } from "./pptxEditorUtils";

type PptxTimelineDragMode = "move" | "resize-start" | "resize-end";

type PptxTimelineDragState = {
  animationId: string;
  mode: PptxTimelineDragMode;
  startClientX: number;
  startDelayMs: number;
  startDurationMs: number;
  timelineDurationMs: number;
  trackWidth: number;
};

export function PptxAnimationTimeline({
  animations,
  disabled,
  onTimingChange,
}: {
  animations: PptxAnimation[];
  disabled: boolean;
  onTimingChange: (
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) => void;
}) {
  const [dragState, setDragState] = useState<PptxTimelineDragState | null>(null);
  const durationMs = pptxAnimationTimelineDuration(animations);

  function startTimelineDrag(
    event: ReactPointerEvent<HTMLElement>,
    animation: PptxAnimation,
    mode: PptxTimelineDragMode,
  ) {
    if (disabled) return;
    const track = event.currentTarget.closest<HTMLElement>(
      "[data-pptx-animation-track]",
    );
    const trackRect = track?.getBoundingClientRect();
    if (!track || !trackRect) return;
    event.preventDefault();
    event.stopPropagation();
    track.setPointerCapture(event.pointerId);
    setDragState({
      animationId: animation.id,
      mode,
      startClientX: event.clientX,
      startDelayMs: Math.max(0, animation.delayMs ?? 0),
      startDurationMs: Math.max(100, animation.durationMs ?? 500),
      timelineDurationMs: durationMs,
      trackWidth: Math.max(1, trackRect.width),
    });
  }

  function updateTimelineDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragState) return;
    const deltaMs = snapTimelineMilliseconds(
      ((event.clientX - dragState.startClientX) / dragState.trackWidth) *
        dragState.timelineDurationMs,
    );
    if (dragState.mode === "move") {
      onTimingChange(dragState.animationId, {
        delayMs: clampTimelineMilliseconds(dragState.startDelayMs + deltaMs),
      });
      return;
    }
    if (dragState.mode === "resize-start") {
      const originalEnd = dragState.startDelayMs + dragState.startDurationMs;
      const nextDelay = Math.min(
        originalEnd - 100,
        Math.max(0, dragState.startDelayMs + deltaMs),
      );
      onTimingChange(dragState.animationId, {
        delayMs: clampTimelineMilliseconds(nextDelay),
        durationMs: clampTimelineMilliseconds(originalEnd - nextDelay, 100),
      });
      return;
    }
    onTimingChange(dragState.animationId, {
      durationMs: clampTimelineMilliseconds(
        dragState.startDurationMs + deltaMs,
        100,
      ),
    });
  }

  function endTimelineDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragState) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragState(null);
  }

  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        <span>Timeline</span>
        <span>{pptxFormatMilliseconds(durationMs)}</span>
      </div>
      <div className="grid gap-1.5">
        {animations.map((animation, index) => {
          const start = Math.max(0, animation.delayMs ?? 0);
          const duration = Math.max(100, animation.durationMs ?? 500);
          const left = Math.min(96, (start / durationMs) * 100);
          const width = Math.max(
            4,
            Math.min(100 - left, (duration / durationMs) * 100),
          );
          return (
            <div
              key={`${animation.id}:timeline:${index}`}
              className="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-2 text-[10px]"
            >
              <span className="truncate text-[var(--text-muted)]">
                {animationLabel(animation)}
              </span>
              <div
                data-pptx-animation-track
                onPointerMove={updateTimelineDrag}
                onPointerUp={endTimelineDrag}
                onPointerCancel={endTimelineDrag}
                className="relative h-5 overflow-hidden rounded bg-[var(--bg)]"
              >
                <div
                  onPointerDown={(event) =>
                    startTimelineDrag(event, animation, "move")
                  }
                  className="absolute top-1 h-3 cursor-grab rounded bg-[var(--accent)]/75 active:cursor-grabbing"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                  }}
                >
                  <button
                    type="button"
                    aria-label="Resize animation start"
                    disabled={disabled}
                    onPointerDown={(event) =>
                      startTimelineDrag(event, animation, "resize-start")
                    }
                    className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l bg-white/40 opacity-0 transition-opacity hover:opacity-100 disabled:pointer-events-none"
                  />
                  <button
                    type="button"
                    aria-label="Resize animation end"
                    disabled={disabled}
                    onPointerDown={(event) =>
                      startTimelineDrag(event, animation, "resize-end")
                    }
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/40 opacity-0 transition-opacity hover:opacity-100 disabled:pointer-events-none"
                  />
                </div>
              </div>
              <span className="text-right font-mono text-[var(--text-faint)]">
                {pptxFormatMilliseconds(start)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pptxAnimationTimelineDuration(animations: PptxAnimation[]) {
  return Math.max(
    1000,
    ...animations.map(
      (animation) =>
        (animation.delayMs ?? 0) + Math.max(100, animation.durationMs ?? 500),
    ),
  );
}

function pptxFormatMilliseconds(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

function snapTimelineMilliseconds(milliseconds: number) {
  return Math.round(milliseconds / 50) * 50;
}

function clampTimelineMilliseconds(milliseconds: number, min = 0) {
  return Math.min(600_000, Math.max(min, Math.round(milliseconds)));
}
