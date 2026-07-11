import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { PptxAnimation } from "../shared/models";
import { pptxAnimationTimelineDuration, pptxFormatMilliseconds } from "./pptxAnimationTimingUtils";
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
  previewPatch?: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">;
};

export function PptxAnimationTimeline({
  animations,
  disabled,
  playheadMs,
  onPlayheadChange,
  onTimingChange,
}: {
  animations: PptxAnimation[];
  disabled: boolean;
  playheadMs?: number;
  onPlayheadChange?: (milliseconds: number) => void;
  onTimingChange: (
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) => void;
}) {
  const [dragState, setDragState] = useState<PptxTimelineDragState | null>(null);
  const previewAnimations = animations.map((animation) =>
    animation.id === dragState?.animationId
      ? { ...animation, ...dragState.previewPatch }
      : animation,
  );
  const durationMs = pptxAnimationTimelineDuration(previewAnimations);
  const playheadPercent =
    playheadMs === undefined
      ? null
      : Math.min(100, Math.max(0, (playheadMs / durationMs) * 100));

  useEffect(() => {
    if (!dragState) return;
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDragState(null);
    }
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [dragState]);

  function seekTimeline(event: ReactPointerEvent<HTMLElement>) {
    if (!onPlayheadChange || disabled || dragState) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    onPlayheadChange(
      clampTimelineMilliseconds(snapTimelineMilliseconds(ratio * durationMs)),
    );
  }

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
      setDragState({
        ...dragState,
        previewPatch: {
          delayMs: clampTimelineMilliseconds(dragState.startDelayMs + deltaMs),
        },
      });
      return;
    }
    if (dragState.mode === "resize-start") {
      const originalEnd = dragState.startDelayMs + dragState.startDurationMs;
      const nextDelay = Math.min(
        originalEnd - 100,
        Math.max(0, dragState.startDelayMs + deltaMs),
      );
      setDragState({
        ...dragState,
        previewPatch: {
          delayMs: clampTimelineMilliseconds(nextDelay),
          durationMs: clampTimelineMilliseconds(originalEnd - nextDelay, 100),
        },
      });
      return;
    }
    setDragState({
      ...dragState,
      previewPatch: {
        durationMs: clampTimelineMilliseconds(
          dragState.startDurationMs + deltaMs,
          100,
        ),
      },
    });
  }

  function endTimelineDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragState) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragState.previewPatch) {
      onTimingChange(dragState.animationId, dragState.previewPatch);
    }
    setDragState(null);
  }

  function cancelTimelineDrag() {
    setDragState(null);
  }

  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        <span>Timeline</span>
        <span>{pptxFormatMilliseconds(durationMs)}</span>
      </div>
      <div className="grid gap-1.5">
        {previewAnimations.map((animation, index) => {
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
                onPointerDown={seekTimeline}
                onPointerMove={updateTimelineDrag}
                onPointerUp={endTimelineDrag}
                onPointerCancel={cancelTimelineDrag}
                onLostPointerCapture={cancelTimelineDrag}
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
                {playheadPercent !== null && (
                  <div
                    className="pointer-events-none absolute bottom-0 top-0 w-px bg-[var(--status-warning)]"
                    style={{ left: `${playheadPercent}%` }}
                  />
                )}
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

function snapTimelineMilliseconds(milliseconds: number) {
  return Math.round(milliseconds / 50) * 50;
}

function clampTimelineMilliseconds(milliseconds: number, min = 0) {
  return Math.min(600_000, Math.max(min, Math.round(milliseconds)));
}
