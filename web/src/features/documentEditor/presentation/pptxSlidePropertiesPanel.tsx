import { PptxChartDataEditor } from "./pptxChartDataEditor";
import {
  PptxAnimationInspector,
  PptxMediaInspector,
} from "./pptxInspectors";
import { PptxMasterEditor } from "./pptxMasterEditor";
import { PptxThemeEditor } from "./pptxThemeEditor";
import type {
  PptxAnimation,
  PptxChart,
  PptxMaster,
  PptxMedia,
  PptxModel,
  PptxSlide,
  PptxText,
  PptxTheme,
  PptxTransition,
} from "../shared/models";

type PptxSlidePropertiesPanelProps = {
  model: PptxModel;
  slide?: PptxSlide;
  activeChart?: PptxChart | null;
  activeTheme?: PptxTheme;
  onChartChange: (patch: Partial<PptxChart>) => void;
  onChartSeriesNameChange: (seriesIndex: number, value: string) => void;
  onChartPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
  onAddChartSeries: () => void;
  onDeleteChartSeries: (seriesIndex: number) => void;
  onAddChartPoint: (seriesIndex: number) => void;
  onDeleteChartPoint: (seriesIndex: number, pointIndex: number) => void;
  onSlideLayoutChange: (layoutPath: string) => void;
  onResetSlideLayout: () => void;
  onSlideTransitionChange: (patch: Partial<PptxTransition>) => void;
  onThemeChange: (patch: Partial<PptxTheme>) => void;
  onThemeColorChange: (key: string, color: string) => void;
  onMasterChange: (masterPath: string, patch: Partial<PptxMaster>) => void;
  onMasterPlaceholderChange: (
    masterPath: string,
    placeholderIndex: number,
    patch: Partial<PptxText>,
  ) => void;
  onAnimationTimingChange: (
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) => void;
  onMoveAnimation: (animationId: string, direction: -1 | 1) => void;
  onMediaChange: (mediaId: string, patch: Partial<PptxMedia>) => void;
  onSlideNotesChange: (notes: string) => void;
};

export function PptxSlidePropertiesPanel({
  model,
  slide,
  activeChart,
  activeTheme,
  onChartChange,
  onChartSeriesNameChange,
  onChartPointChange,
  onAddChartSeries,
  onDeleteChartSeries,
  onAddChartPoint,
  onDeleteChartPoint,
  onSlideLayoutChange,
  onResetSlideLayout,
  onSlideTransitionChange,
  onThemeChange,
  onThemeColorChange,
  onMasterChange,
  onMasterPlaceholderChange,
  onAnimationTimingChange,
  onMoveAnimation,
  onMediaChange,
  onSlideNotesChange,
}: PptxSlidePropertiesPanelProps) {
  const activeMasterPath =
    slide?.layoutMasterPath ??
    (slide?.layoutPath
      ? model.layouts?.find((layout) => layout.path === slide.layoutPath)?.masterPath
      : undefined);

  return (
    <>
      {activeChart && (
        <PptxChartDataEditor
          chart={activeChart}
          onChartChange={onChartChange}
          onSeriesNameChange={onChartSeriesNameChange}
          onPointChange={onChartPointChange}
          onAddSeries={onAddChartSeries}
          onDeleteSeries={onDeleteChartSeries}
          onAddPoint={onAddChartPoint}
          onDeletePoint={onDeleteChartPoint}
        />
      )}
      <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] md:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr]">
        <label className="grid gap-1">
          <span className="font-medium uppercase tracking-wide">Layout</span>
          <div className="flex min-w-0 gap-1">
            <select
              value={slide?.layoutPath ?? ""}
              onChange={(event) => onSlideLayoutChange(event.target.value)}
              disabled={!slide || (model.layouts?.length ?? 0) === 0}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {model.layouts?.length ? "No layout" : "No layout metadata"}
              </option>
              {slide?.layoutPath &&
                !(model.layouts ?? []).some(
                  (layout) => layout.path === slide.layoutPath,
                ) && (
                  <option value={slide.layoutPath}>
                    {slide.layoutName ?? slide.layoutPath}
                  </option>
                )}
              {(model.layouts ?? []).map((layout) => (
                <option key={layout.path} value={layout.path}>
                  {[layout.name ?? layout.path, layout.themeName]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onResetSlideLayout}
              disabled={
                !slide?.layoutPath ||
                !model.layouts?.some(
                  (layout) =>
                    layout.path === slide.layoutPath &&
                    (layout.placeholderTexts?.length ?? 0) > 0,
                )
              }
              className="h-8 shrink-0 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </label>
        <label className="grid gap-1">
          <span className="font-medium uppercase tracking-wide">Transition</span>
          <select
            value={slide?.transition?.type ?? "none"}
            onChange={(event) =>
              onSlideTransitionChange({
                type: event.target.value as PptxTransition["type"],
              })
            }
            disabled={!slide}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {[
              "none",
              "fade",
              "push",
              "wipe",
              "split",
              "cut",
              "cover",
              "uncover",
              "zoom",
            ].map((transition) => (
              <option key={transition} value={transition}>
                {transition}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-medium uppercase tracking-wide">Speed</span>
          <select
            value={slide?.transition?.speed ?? "med"}
            onChange={(event) =>
              onSlideTransitionChange({
                speed: event.target.value as PptxTransition["speed"],
              })
            }
            disabled={!slide || (slide.transition?.type ?? "none") === "none"}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {["fast", "med", "slow"].map((speed) => (
              <option key={speed} value={speed}>
                {speed}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-medium uppercase tracking-wide">Direction</span>
          <select
            value={slide?.transition?.direction ?? "l"}
            onChange={(event) =>
              onSlideTransitionChange({ direction: event.target.value })
            }
            disabled={
              !slide ||
              !["push", "wipe", "split", "cover", "uncover", "zoom"].includes(
                slide.transition?.type ?? "none",
              )
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {[
              ["l", "left"],
              ["r", "right"],
              ["u", "up"],
              ["d", "down"],
              ["in", "in"],
              ["out", "out"],
              ["horz", "horizontal"],
              ["vert", "vertical"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-xs text-[var(--text)]">
          <input
            type="checkbox"
            checked={slide?.transition?.advanceOnClick ?? true}
            onChange={(event) =>
              onSlideTransitionChange({ advanceOnClick: event.target.checked })
            }
            disabled={!slide || (slide.transition?.type ?? "none") === "none"}
            className="h-4 w-4 rounded border-[var(--border)]"
          />
          On click
        </label>
        <label className="grid gap-1">
          <span className="font-medium uppercase tracking-wide">Auto ms</span>
          <input
            type="number"
            min={0}
            max={600000}
            step={500}
            value={slide?.transition?.advanceAfterMs ?? 0}
            onChange={(event) =>
              onSlideTransitionChange({
                advanceAfterMs: Math.max(0, Number(event.target.value) || 0),
              })
            }
            disabled={!slide || (slide.transition?.type ?? "none") === "none"}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
      </div>
      <PptxThemeEditor
        theme={activeTheme}
        disabled={!activeTheme}
        onThemeChange={onThemeChange}
        onThemeColorChange={onThemeColorChange}
      />
      <PptxMasterEditor
        masters={model.masters ?? []}
        activeMasterPath={activeMasterPath}
        disabled={(model.masters?.length ?? 0) === 0}
        onMasterChange={onMasterChange}
        onPlaceholderChange={onMasterPlaceholderChange}
      />
      <PptxAnimationInspector
        animations={slide?.animations ?? []}
        disabled={!slide}
        onTimingChange={onAnimationTimingChange}
        onMove={onMoveAnimation}
      />
      <PptxMediaInspector
        media={slide?.media ?? []}
        disabled={!slide}
        onChange={onMediaChange}
      />
      <label className="block shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Speaker notes
        </span>
        <textarea
          value={slide?.notes ?? ""}
          onChange={(event) => onSlideNotesChange(event.target.value)}
          disabled={!slide}
          placeholder="Notes for this slide"
          className="h-24 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
    </>
  );
}
