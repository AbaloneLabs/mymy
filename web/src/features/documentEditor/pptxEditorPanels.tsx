import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useState } from "react";
import { ChartColumn, Move, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { builtInFontFamilies } from "./fonts";
import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxTableCellStyle,
} from "./models";
import {
  isPptxLineShape,
  pptxChartStyle,
  pptxImageStyle,
  pptxSlideBackgroundStyle,
  pptxTableStyle,
} from "./pptxEditorUtils";

export function PptxShapeView({ shape }: { shape: PptxShape }) {
  const strokeWidth = Math.max(0, shape.strokeWidth ?? 2);
  const strokeColor = shape.strokeColor ?? "#111827";
  const fillColor = isPptxLineShape(shape)
    ? "none"
    : (shape.fillColor ?? "transparent");
  if (isPptxLineShape(shape)) {
    const markerPrefix = shape.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const startMarker = pptxLineMarkerId(markerPrefix, "start", shape.lineStartArrow);
    const endMarker = pptxLineMarkerId(markerPrefix, "end", shape.lineEndArrow);
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        {(startMarker || endMarker) && (
          <defs>
            {startMarker && (
              <PptxLineMarker
                id={startMarker}
                type={shape.lineStartArrow}
                color={strokeColor}
              />
            )}
            {endMarker && (
              <PptxLineMarker
                id={endMarker}
                type={shape.lineEndArrow}
                color={strokeColor}
              />
            )}
          </defs>
        )}
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke={strokeColor}
          strokeWidth={Math.max(1, strokeWidth)}
          markerStart={startMarker ? `url(#${startMarker})` : undefined}
          markerEnd={endMarker ? `url(#${endMarker})` : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "roundRect") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="12"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "ellipse") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <ellipse
          cx="50"
          cy="50"
          rx="48"
          ry="48"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "triangle") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "diamond") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,50 50,98 2,50"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "parallelogram") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="24,2 98,2 76,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "trapezoid") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="22,2 78,2 98,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "pentagon") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,38 80,98 20,98 2,38"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "hexagon") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="25,2 75,2 98,50 75,98 25,98 2,50"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "rightArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="2,34 62,34 62,14 98,50 62,86 62,66 2,66"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "leftArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="98,34 38,34 38,14 2,50 38,86 38,66 98,66"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "upArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="34,98 34,38 14,38 50,2 86,38 66,38 66,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "downArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="34,2 34,62 14,62 50,98 86,62 66,62 66,2"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "leftRightArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="2,50 24,24 24,38 76,38 76,24 98,50 76,76 76,62 24,62 24,76"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "star5") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,3 61,36 96,36 68,57 79,92 50,71 21,92 32,57 4,36 39,36"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "heart") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d="M50 90 C18 62 4 45 8 25 C12 6 36 3 50 22 C64 3 88 6 92 25 C96 45 82 62 50 90 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "cloud") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d="M24 78 C12 78 4 69 6 58 C8 48 17 42 27 44 C29 29 42 18 58 22 C70 25 78 34 80 46 C90 47 98 55 98 66 C98 76 89 84 78 84 L24 84 C24 84 24 78 24 78 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <rect
        x="1"
        y="1"
        width="98"
        height="98"
        rx="3"
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function pptxLineMarkerId(
  prefix: string,
  edge: "start" | "end",
  type: PptxShape["lineStartArrow"],
) {
  if (!type || type === "none") return null;
  return `pptx-line-${prefix}-${edge}-${type}`;
}

function PptxLineMarker({
  id,
  type,
  color,
}: {
  id: string;
  type: PptxShape["lineStartArrow"];
  color: string;
}) {
  if (!type || type === "none") return null;
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
      markerUnits="strokeWidth"
    >
      {type === "diamond" ? (
        <polygon points="0,5 5,0 10,5 5,10" fill={color} />
      ) : type === "oval" ? (
        <ellipse cx="5" cy="5" rx="4.5" ry="4.5" fill={color} />
      ) : type === "stealth" ? (
        <path d="M 0 0 L 10 5 L 0 10 L 3 5 Z" fill={color} />
      ) : (
        <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} />
      )}
    </marker>
  );
}

export function PptxImageView({ image }: { image: PptxImage }) {
  const crop = pptxImageCropBox(image);
  if (!image.dataUrl) {
    return (
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden border border-dashed border-neutral-300 bg-neutral-50 px-2 text-center text-[10px] text-neutral-500"
        style={{ clipPath: crop.clipPath }}
      >
        {image.mediaPath ?? "Image"}
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <img
        src={image.dataUrl}
        alt={image.altText ?? image.mediaPath ?? "Slide image"}
        draggable={false}
        className="h-full w-full object-fill"
        style={crop.imageStyle}
      />
    </div>
  );
}

function pptxImageCropBox(image: PptxImage) {
  const left = clampPptxCropPercent(image.imageCropLeft);
  const top = clampPptxCropPercent(image.imageCropTop);
  const right = clampPptxCropPercent(image.imageCropRight);
  const bottom = clampPptxCropPercent(image.imageCropBottom);
  const visibleWidth = Math.max(1, 100 - left - right);
  const visibleHeight = Math.max(1, 100 - top - bottom);
  return {
    clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`,
    imageStyle: {
      width: `${(100 / visibleWidth) * 100}%`,
      height: `${(100 / visibleHeight) * 100}%`,
      transform: `translate(${-left}%, ${-top}%)`,
      transformOrigin: "top left",
    },
  };
}

function clampPptxCropPercent(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, Number(value)));
}

export function PptxChartDataEditor({
  chart,
  onChartChange,
  onSeriesNameChange,
  onPointChange,
  onAddSeries,
  onDeleteSeries,
  onAddPoint,
  onDeletePoint,
}: {
  chart: PptxChart;
  onChartChange: (patch: Partial<PptxChart>) => void;
  onSeriesNameChange: (seriesIndex: number, value: string) => void;
  onPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
  onAddSeries: () => void;
  onDeleteSeries: (seriesIndex: number) => void;
  onAddPoint: (seriesIndex: number) => void;
  onDeletePoint: (seriesIndex: number, pointIndex: number) => void;
}) {
  const seriesList = chart.series ?? [];
  return (
    <div className="max-h-56 shrink-0 overflow-auto border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
      <div className="mb-2 grid gap-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          <ChartColumn className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">Chart data</span>
          <button
            type="button"
            onClick={onAddSeries}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] normal-case tracking-normal text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Series
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-[auto_8rem_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={chart.legendVisible ?? false}
              onChange={(event) =>
                onChartChange({ legendVisible: event.currentTarget.checked })
              }
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            Legend
          </label>
          <select
            value={chart.legendPosition ?? "r"}
            onChange={(event) =>
              onChartChange({
                legendVisible: true,
                legendPosition: event.currentTarget.value as PptxChart["legendPosition"],
              })
            }
            disabled={chart.legendVisible === false}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Legend position"
          >
            <option value="r">Right</option>
            <option value="l">Left</option>
            <option value="t">Top</option>
            <option value="b">Bottom</option>
            <option value="tr">Top right</option>
          </select>
          <input
            value={chart.categoryAxisTitle ?? ""}
            onChange={(event) =>
              onChartChange({ categoryAxisTitle: event.currentTarget.value })
            }
            placeholder="Category axis"
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <input
            value={chart.valueAxisTitle ?? ""}
            onChange={(event) =>
              onChartChange({ valueAxisTitle: event.currentTarget.value })
            }
            placeholder="Value axis"
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <label className="grid min-w-0 gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Category position
            </span>
            <select
              value={chart.categoryAxisPosition ?? "b"}
              onChange={(event) =>
                onChartChange({
                  categoryAxisPosition: event.currentTarget
                    .value as PptxChart["categoryAxisPosition"],
                })
              }
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="b">Bottom</option>
              <option value="t">Top</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Value position
            </span>
            <select
              value={chart.valueAxisPosition ?? "l"}
              onChange={(event) =>
                onChartChange({
                  valueAxisPosition: event.currentTarget
                    .value as PptxChart["valueAxisPosition"],
                })
              }
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="l">Left</option>
              <option value="r">Right</option>
            </select>
          </label>
          <label className="inline-flex h-full min-h-12 items-end gap-2 rounded-md border border-[var(--border)] px-2 py-2 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={chart.categoryMajorGridlines ?? false}
              onChange={(event) =>
                onChartChange({
                  categoryMajorGridlines: event.currentTarget.checked,
                })
              }
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            Category grid
          </label>
          <label className="inline-flex h-full min-h-12 items-end gap-2 rounded-md border border-[var(--border)] px-2 py-2 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={chart.valueMajorGridlines ?? false}
              onChange={(event) =>
                onChartChange({ valueMajorGridlines: event.currentTarget.checked })
              }
              className="h-4 w-4 rounded border-[var(--border)]"
            />
            Value grid
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <PptxAxisStyleControls
            axis="category"
            chart={chart}
            onChartChange={onChartChange}
          />
          <PptxAxisStyleControls
            axis="value"
            chart={chart}
            onChartChange={onChartChange}
          />
        </div>
      </div>
      {seriesList.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">
          No chart data
        </div>
      ) : (
        <div className="grid gap-2">
          {seriesList.map((series, seriesIndex) => {
            const rowCount = Math.max(
              series.categories?.length ?? 0,
              series.values?.length ?? 0,
              chart.categories?.length ?? 0,
            );
            return (
              <div
                key={`${series.name ?? "series"}-${seriesIndex}`}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
              >
                <div className="mb-2 grid gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Series
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      value={series.name ?? ""}
                      onChange={(event) =>
                        onSeriesNameChange(seriesIndex, event.target.value)
                      }
                      className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => onAddPoint(seriesIndex)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      title="Add point"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSeries(seriesIndex)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
                      title="Delete series"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
                {rowCount > 0 ? (
                  <table className="w-full table-fixed border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-[var(--text-muted)]">
                        <th className="border border-[var(--border)] px-2 py-1 font-medium">
                          Category
                        </th>
                        <th className="border border-[var(--border)] px-2 py-1 font-medium">
                          Value
                        </th>
                        <th className="w-8 border border-[var(--border)] px-1 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: rowCount }).map((_, pointIndex) => (
                        <tr key={pointIndex}>
                          <td className="border border-[var(--border)] p-0">
                            <input
                              value={
                                series.categories?.[pointIndex] ??
                                chart.categories?.[pointIndex] ??
                                ""
                              }
                              onChange={(event) =>
                                onPointChange(
                                  seriesIndex,
                                  pointIndex,
                                  "categories",
                                  event.target.value,
                                )
                              }
                              className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                            />
                          </td>
                          <td className="border border-[var(--border)] p-0">
                            <input
                              value={series.values?.[pointIndex] ?? ""}
                              onChange={(event) =>
                                onPointChange(
                                  seriesIndex,
                                  pointIndex,
                                  "values",
                                  event.target.value,
                                )
                              }
                              className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                            />
                          </td>
                          <td className="border border-[var(--border)] p-0 text-center">
                            <button
                              type="button"
                              onClick={() => onDeletePoint(seriesIndex, pointIndex)}
                              className="inline-flex h-8 w-8 items-center justify-center text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
                              title="Delete point"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="rounded border border-dashed border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
                    No chart data
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PPTX_AXIS_STYLE_FIELDS = {
  category: {
    title: "Category axis style",
    tickLabelPosition: "categoryAxisTickLabelPosition",
    majorTickMark: "categoryAxisMajorTickMark",
    minorTickMark: "categoryAxisMinorTickMark",
    numberFormat: "categoryAxisNumberFormat",
    lineColor: "categoryAxisLineColor",
    lineWidth: "categoryAxisLineWidth",
    lineDash: "categoryAxisLineDash",
    labelTextColor: "categoryAxisLabelTextColor",
    labelFontSize: "categoryAxisLabelFontSize",
    labelRotation: "categoryAxisLabelRotation",
    labelBold: "categoryAxisLabelBold",
    labelItalic: "categoryAxisLabelItalic",
  },
  value: {
    title: "Value axis style",
    tickLabelPosition: "valueAxisTickLabelPosition",
    majorTickMark: "valueAxisMajorTickMark",
    minorTickMark: "valueAxisMinorTickMark",
    numberFormat: "valueAxisNumberFormat",
    lineColor: "valueAxisLineColor",
    lineWidth: "valueAxisLineWidth",
    lineDash: "valueAxisLineDash",
    labelTextColor: "valueAxisLabelTextColor",
    labelFontSize: "valueAxisLabelFontSize",
    labelRotation: "valueAxisLabelRotation",
    labelBold: "valueAxisLabelBold",
    labelItalic: "valueAxisLabelItalic",
  },
} as const;

function PptxAxisStyleControls({
  axis,
  chart,
  onChartChange,
}: {
  axis: "category" | "value";
  chart: PptxChart;
  onChartChange: (patch: Partial<PptxChart>) => void;
}) {
  const fields = PPTX_AXIS_STYLE_FIELDS[axis];

  function updateField<K extends keyof PptxChart>(key: K, value: PptxChart[K]) {
    onChartChange({ [key]: value } as Partial<PptxChart>);
  }

  return (
    <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {fields.title}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="grid gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Labels</span>
          <select
            value={chart[fields.tickLabelPosition] ?? "nextTo"}
            onChange={(event) =>
              updateField(
                fields.tickLabelPosition,
                event.currentTarget
                  .value as PptxChart[typeof fields.tickLabelPosition],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="nextTo">Next to axis</option>
            <option value="low">Low</option>
            <option value="high">High</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Major tick</span>
          <select
            value={chart[fields.majorTickMark] ?? "none"}
            onChange={(event) =>
              updateField(
                fields.majorTickMark,
                event.currentTarget.value as PptxChart[typeof fields.majorTickMark],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="none">None</option>
            <option value="in">Inside</option>
            <option value="out">Outside</option>
            <option value="cross">Cross</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Minor tick</span>
          <select
            value={chart[fields.minorTickMark] ?? "none"}
            onChange={(event) =>
              updateField(
                fields.minorTickMark,
                event.currentTarget.value as PptxChart[typeof fields.minorTickMark],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="none">None</option>
            <option value="in">Inside</option>
            <option value="out">Outside</option>
            <option value="cross">Cross</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Format</span>
          <input
            type="text"
            value={chart[fields.numberFormat] ?? ""}
            placeholder={axis === "value" ? "#,##0" : "General"}
            onChange={(event) =>
              updateField(
                fields.numberFormat,
                event.currentTarget.value as PptxChart[typeof fields.numberFormat],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(4rem,1fr)_minmax(5rem,1fr)_auto_auto_minmax(4rem,1fr)_minmax(5rem,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Line</span>
          <input
            type="color"
            value={chart[fields.lineColor] ?? "#64748b"}
            onChange={(event) =>
              updateField(
                fields.lineColor,
                event.currentTarget.value as PptxChart[typeof fields.lineColor],
              )
            }
            className="h-8 w-10 rounded-md border border-[var(--border)] bg-[var(--bg)] p-1"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Width</span>
          <input
            type="number"
            min={0}
            max={72}
            step={0.25}
            value={chart[fields.lineWidth] ?? 1}
            onChange={(event) =>
              updateField(
                fields.lineWidth,
                Math.max(
                  0,
                  Math.min(72, Number(event.currentTarget.value) || 0),
                ) as PptxChart[typeof fields.lineWidth],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Dash</span>
          <select
            value={chart[fields.lineDash] ?? "solid"}
            onChange={(event) =>
              updateField(
                fields.lineDash,
                event.currentTarget.value as PptxChart[typeof fields.lineDash],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="solid">Solid</option>
            <option value="dash">Dash</option>
            <option value="dot">Dot</option>
            <option value="dashDot">Dash dot</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Text</span>
          <input
            type="color"
            value={chart[fields.labelTextColor] ?? "#111827"}
            onChange={(event) =>
              updateField(
                fields.labelTextColor,
                event.currentTarget
                  .value as PptxChart[typeof fields.labelTextColor],
              )
            }
            className="h-8 w-10 rounded-md border border-[var(--border)] bg-[var(--bg)] p-1"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Size</span>
          <input
            type="number"
            min={6}
            max={72}
            value={chart[fields.labelFontSize] ?? 10}
            onChange={(event) =>
              updateField(
                fields.labelFontSize,
                Math.max(
                  6,
                  Math.min(72, Number(event.currentTarget.value) || 10),
                ) as PptxChart[typeof fields.labelFontSize],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid min-w-0 gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Rotation</span>
          <input
            type="number"
            min={-90}
            max={90}
            step={5}
            value={chart[fields.labelRotation] ?? 0}
            onChange={(event) =>
              updateField(
                fields.labelRotation,
                Math.max(
                  -90,
                  Math.min(90, Number(event.currentTarget.value) || 0),
                ) as PptxChart[typeof fields.labelRotation],
              )
            }
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-end gap-1">
          <button
            type="button"
            aria-pressed={chart[fields.labelBold] ?? false}
            onClick={() =>
              updateField(
                fields.labelBold,
                !(chart[fields.labelBold] ?? false) as PptxChart[typeof fields.labelBold],
              )
            }
            className={cn(
              "h-8 w-8 rounded-md border border-[var(--border)] text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              chart[fields.labelBold] &&
                "border-[var(--accent)] text-[var(--accent)]",
            )}
            title="Bold"
          >
            B
          </button>
          <button
            type="button"
            aria-pressed={chart[fields.labelItalic] ?? false}
            onClick={() =>
              updateField(
                fields.labelItalic,
                !(chart[fields.labelItalic] ?? false) as PptxChart[typeof fields.labelItalic],
              )
            }
            className={cn(
              "h-8 w-8 rounded-md border border-[var(--border)] text-xs italic text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              chart[fields.labelItalic] &&
                "border-[var(--accent)] text-[var(--accent)]",
            )}
            title="Italic"
          >
            I
          </button>
        </div>
      </div>
    </div>
  );
}

export function PptxChartView({ chart }: { chart: PptxChart }) {
  const values = (chart.series ?? [])
    .flatMap((series) => series.values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));
  const chartPlotStyle = pptxChartPlotStyle(chart);
  const categoryAxisLabelStyle = pptxChartAxisLabelStyle(chart, "category");
  const valueAxisLabelStyle = pptxChartAxisLabelStyle(chart, "value");

  return (
    <div className="flex h-full w-full flex-col border border-neutral-300 bg-white p-2 text-neutral-900 shadow-sm">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ChartColumn className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={1.75} />
          <div className="min-w-0 truncate text-xs font-semibold">
            {chart.title || chart.path || "Chart"}
          </div>
        </div>
        <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
          {chart.type ?? "chart"}
        </span>
      </div>
      {(chart.series ?? []).length > 0 ? (
        <div
          className="grid min-h-0 flex-1 gap-1 overflow-hidden rounded-sm border border-neutral-100 p-1"
          style={chartPlotStyle}
        >
          {(chart.series ?? []).slice(0, 4).map((series, seriesIndex) => (
            <div key={`${series.name ?? "series"}-${seriesIndex}`} className="min-h-0">
              <div className="truncate text-[10px] text-neutral-500">
                {series.name || "Unnamed series"}
              </div>
              <div className="mt-0.5 flex h-8 items-end gap-1">
                {(series.values ?? []).slice(0, 12).map((value, valueIndex) => {
                  const numberValue = Number(value);
                  const height = Number.isFinite(numberValue)
                    ? `${Math.max(8, (Math.abs(numberValue) / maxValue) * 100)}%`
                    : "8%";
                  return (
                    <div
                      key={`${value}-${valueIndex}`}
                      title={`${series.categories?.[valueIndex] ?? chart.categories?.[valueIndex] ?? ""} ${value}`}
                      className="min-w-1 flex-1 rounded-t-sm bg-emerald-500"
                      style={{ height }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center border border-dashed border-neutral-200 text-[10px] text-neutral-400">
          No chart data
        </div>
      )}
      {(chart.categoryAxisTitle || chart.valueAxisTitle) && (
        <div className="mt-1 grid shrink-0 grid-cols-2 gap-2 text-[9px] text-neutral-500">
          <span className="truncate" style={categoryAxisLabelStyle}>
            {chart.categoryAxisTitle ?? ""}
          </span>
          <span className="truncate text-right" style={valueAxisLabelStyle}>
            {chart.valueAxisTitle ?? ""}
          </span>
        </div>
      )}
    </div>
  );
}

function pptxChartPlotStyle(chart: PptxChart): CSSProperties {
  const style: CSSProperties = {
    ...(pptxChartGridStyle(chart) ?? {}),
  };
  const categoryBorder = pptxChartAxisBorder(chart, "category");
  const valueBorder = pptxChartAxisBorder(chart, "value");
  if (chart.categoryAxisPosition === "t") {
    style.borderTop = categoryBorder;
  } else {
    style.borderBottom = categoryBorder;
  }
  if (chart.valueAxisPosition === "r") {
    style.borderRight = valueBorder;
  } else {
    style.borderLeft = valueBorder;
  }
  return style;
}

function pptxChartAxisBorder(chart: PptxChart, axis: "category" | "value") {
  const isCategory = axis === "category";
  const color = isCategory
    ? chart.categoryAxisLineColor
    : chart.valueAxisLineColor;
  const width = isCategory
    ? chart.categoryAxisLineWidth
    : chart.valueAxisLineWidth;
  const dash = isCategory ? chart.categoryAxisLineDash : chart.valueAxisLineDash;
  return `${Math.max(1, Math.min(6, width ?? 1))}px ${pptxCssBorderStyle(
    dash,
  )} ${color ?? "#e5e5e5"}`;
}

function pptxCssBorderStyle(dash: PptxChart["categoryAxisLineDash"]) {
  if (dash === "dot") return "dotted";
  if (dash === "dash" || dash === "dashDot") return "dashed";
  return "solid";
}

function pptxChartAxisLabelStyle(
  chart: PptxChart,
  axis: "category" | "value",
): CSSProperties {
  const isCategory = axis === "category";
  const color = isCategory
    ? chart.categoryAxisLabelTextColor
    : chart.valueAxisLabelTextColor;
  const fontSize = isCategory
    ? chart.categoryAxisLabelFontSize
    : chart.valueAxisLabelFontSize;
  const bold = isCategory
    ? chart.categoryAxisLabelBold
    : chart.valueAxisLabelBold;
  const italic = isCategory
    ? chart.categoryAxisLabelItalic
    : chart.valueAxisLabelItalic;
  const rotation = isCategory
    ? chart.categoryAxisLabelRotation
    : chart.valueAxisLabelRotation;
  return {
    color,
    display: rotation ? "inline-block" : undefined,
    fontSize: fontSize ? `${Math.max(8, Math.min(12, fontSize))}px` : undefined,
    fontWeight: bold ? 700 : undefined,
    fontStyle: italic ? "italic" : undefined,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    transformOrigin: isCategory ? "left center" : "right center",
  };
}

function pptxChartGridStyle(chart: PptxChart): CSSProperties | undefined {
  const backgrounds: string[] = [];
  const sizes: string[] = [];
  if (chart.valueMajorGridlines) {
    backgrounds.push(
      "linear-gradient(to top, rgba(16, 185, 129, 0.18) 1px, transparent 1px)",
    );
    sizes.push("100% 25%");
  }
  if (chart.categoryMajorGridlines) {
    backgrounds.push(
      "linear-gradient(to right, rgba(16, 185, 129, 0.14) 1px, transparent 1px)",
    );
    sizes.push("16.666% 100%");
  }
  if (backgrounds.length === 0) {
    return undefined;
  }
  return {
    backgroundImage: backgrounds.join(", "),
    backgroundSize: sizes.join(", "),
    backgroundPosition: "left bottom",
  };
}

export function PptxEditableTable({
  table,
  selected,
  zIndex,
  onSelect,
  onStartMove,
  onStartResize,
  onKeyDown,
  onCellChange,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onDeleteColumn,
  onColumnWidthChange,
  onRowHeightChange,
  onCellStyleChange,
}: {
  table: PptxTable;
  selected: boolean;
  zIndex: number;
  onSelect: (event?: ReactPointerEvent<HTMLElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCellChange: (rowIndex: number, columnIndex: number, value: string) => void;
  onAddRow: (rowIndex: number) => void;
  onAddColumn: (columnIndex: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onDeleteColumn: (columnIndex: number) => void;
  onColumnWidthChange: (columnIndex: number, value: number) => void;
  onRowHeightChange: (rowIndex: number, value: number) => void;
  onCellStyleChange: (
    rowIndex: number,
    columnIndex: number,
    patch: Partial<PptxTableCellStyle>,
  ) => void;
}) {
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  const canDeleteRow = table.rows.length > 1;
  const canDeleteColumn = columnCount > 1;
  const activeColumnWidth =
    table.columnWidths?.[activeCell.column] ?? 100 / Math.max(columnCount, 1);
  const activeRowHeight =
    table.rowHeights?.[activeCell.row] ?? 100 / Math.max(table.rows.length, 1);
  const activeCellStyle = pptxTableCellStyleAt(
    table,
    activeCell.row,
    activeCell.column,
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute border border-neutral-400 bg-white text-neutral-950 shadow-sm outline-none",
        selected && "ring-2 ring-[var(--accent)]/40",
      )}
      style={pptxTableStyle(table, zIndex)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        onKeyDown(event);
      }}
    >
      {selected && (
        <div className="absolute -top-9 right-0 z-30 flex items-center gap-1 rounded-md border border-neutral-300 bg-white p-1 text-[10px] text-neutral-600 shadow-sm">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddRow(activeCell.row);
            }}
            className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 hover:bg-neutral-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Row
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddColumn(activeCell.column);
            }}
            className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 hover:bg-neutral-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Col
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteRow(activeCell.row);
              setActiveCell((current) => ({
                ...current,
                row: Math.max(0, current.row - 1),
              }));
            }}
            disabled={!canDeleteRow}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete row"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteColumn(activeCell.column);
              setActiveCell((current) => ({
                ...current,
                column: Math.max(0, current.column - 1),
              }));
            }}
            disabled={!canDeleteColumn}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete column"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <label className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1 text-[10px]">
            W
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(activeColumnWidth)}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                onColumnWidthChange(
                  activeCell.column,
                  Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)),
                )
              }
              className="h-4 w-10 bg-transparent outline-none"
            />
          </label>
          <label className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1 text-[10px]">
            H
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(activeRowHeight)}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                onRowHeightChange(
                  activeCell.row,
                  Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)),
                )
              }
              className="h-4 w-10 bg-transparent outline-none"
            />
          </label>
          <input
            type="color"
            value={activeCellStyle.fillColor ?? "#ffffff"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                fillColor: event.currentTarget.value,
              })
            }
            className="h-5 w-6 cursor-pointer bg-transparent"
            title="Cell fill"
          />
          <input
            type="color"
            value={activeCellStyle.textColor ?? "#111827"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                textColor: event.currentTarget.value,
              })
            }
            className="h-5 w-6 cursor-pointer bg-transparent"
            title="Text color"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCellStyleChange(activeCell.row, activeCell.column, {
                bold: !activeCellStyle.bold,
              });
            }}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 font-semibold",
              activeCellStyle.bold && "bg-blue-50 text-blue-700",
            )}
            title="Bold cell"
          >
            B
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCellStyleChange(activeCell.row, activeCell.column, {
                italic: !activeCellStyle.italic,
              });
            }}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 italic",
              activeCellStyle.italic && "bg-blue-50 text-blue-700",
            )}
            title="Italic cell"
          >
            I
          </button>
          <select
            value={activeCellStyle.align ?? "left"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                align: event.currentTarget.value as PptxTableCellStyle["align"],
              })
            }
            className="h-6 rounded border border-neutral-200 bg-white px-1 text-[10px]"
            title="Cell alignment"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      )}
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <PptxTableColumnGroup table={table} />
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={pptxTableRowStyle(table, rowIndex)}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={pptxTableCellClassName(
                    table,
                    rowIndex,
                    columnIndex,
                    "p-0",
                  )}
                  style={pptxTableCellStyle(table, rowIndex, columnIndex)}
                >
                  <textarea
                    value={cell}
                    onFocus={() => {
                      onSelect();
                      setActiveCell({ row: rowIndex, column: columnIndex });
                    }}
                    onClick={() =>
                      setActiveCell({ row: rowIndex, column: columnIndex })
                    }
                    onChange={(event) =>
                      onCellChange(rowIndex, columnIndex, event.target.value)
                    }
                    style={pptxTableCellTextStyle(table, rowIndex, columnIndex)}
                    className="h-full min-h-8 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-4 outline-none focus:bg-blue-50"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <button
          type="button"
          onPointerDown={onStartMove}
          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
          title="Move table"
        >
          <Move className="h-3 w-3" strokeWidth={1.75} />
          Move
        </button>
      )}
      {selected && (
        <button
          type="button"
          onPointerDown={onStartResize}
          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
          title="Resize table"
        />
      )}
    </div>
  );
}

export function PptxTableView({
  table,
  zIndex,
}: {
  table: PptxTable;
  zIndex: number;
}) {
  return (
    <div
      className="absolute overflow-hidden border border-neutral-400 bg-white text-neutral-950"
      style={pptxTableStyle(table, zIndex)}
    >
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <PptxTableColumnGroup table={table} />
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={pptxTableRowStyle(table, rowIndex)}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={pptxTableCellClassName(
                    table,
                    rowIndex,
                    columnIndex,
                    "whitespace-pre-wrap px-1 py-0.5 align-top",
                  )}
                  style={{
                    ...pptxTableCellStyle(table, rowIndex, columnIndex),
                    ...pptxTableCellTextStyle(table, rowIndex, columnIndex),
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pptxTableCellClassName(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
  extraClassName: string,
) {
  const rowCount = table.rows.length;
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  const header = table.firstRow !== false && rowIndex === 0;
  const total = table.lastRow && rowIndex === rowCount - 1;
  const firstColumn = table.firstColumn && columnIndex === 0;
  const lastColumn = table.lastColumn && columnIndex === columnCount - 1;
  const bandedRow =
    table.bandedRows !== false && rowIndex > 0 && !total && rowIndex % 2 === 1;
  const bandedColumn =
    table.bandedColumns && columnIndex > 0 && !lastColumn && columnIndex % 2 === 1;
  return cn(
    "border border-neutral-300",
    (header || total) && "bg-blue-100 font-semibold text-blue-950",
    !header && !total && bandedRow && "bg-neutral-50",
    !header && !total && bandedColumn && "bg-sky-50",
    (firstColumn || lastColumn) && "font-semibold",
    extraClassName,
  );
}

function pptxTableCellStyleAt(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): PptxTableCellStyle {
  return table.cellStyles?.[rowIndex]?.[columnIndex] ?? {};
}

function pptxTableCellStyle(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): CSSProperties {
  const style = pptxTableCellStyleAt(table, rowIndex, columnIndex);
  return style.fillColor ? { backgroundColor: style.fillColor } : {};
}

function pptxTableCellTextStyle(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): CSSProperties {
  const style = pptxTableCellStyleAt(table, rowIndex, columnIndex);
  return {
    color: style.textColor,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textAlign: style.align,
  };
}

function PptxTableColumnGroup({ table }: { table: PptxTable }) {
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  if (columnCount === 0) return null;
  return (
    <colgroup>
      {Array.from({ length: columnCount }, (_, columnIndex) => (
        <col
          key={columnIndex}
          style={{
            width: `${table.columnWidths?.[columnIndex] ?? 100 / columnCount}%`,
          }}
        />
      ))}
    </colgroup>
  );
}

function pptxTableRowStyle(table: PptxTable, rowIndex: number) {
  if (!table.rowHeights?.[rowIndex]) return undefined;
  return { height: `${table.rowHeights[rowIndex]}%` };
}

export function PptxReadOnlySlide({ slide }: { slide: PptxSlide }) {
  return (
    <div
      className="relative aspect-video w-full max-w-6xl overflow-hidden shadow-2xl"
      style={pptxSlideBackgroundStyle(slide)}
    >
      {(slide.shapes ?? []).map((shape, index) => (
        <div
          key={shape.id}
          className="absolute"
          style={{
            left: `${shape.x ?? 24}%`,
            top: `${shape.y ?? 34}%`,
            width: `${shape.width ?? 26}%`,
            height: `${isPptxLineShape(shape) ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
            transform: `rotate(${shape.rotation ?? 0}deg)`,
            zIndex: index + 1,
          }}
        >
          <PptxShapeView shape={shape} />
        </div>
      ))}
      {(slide.images ?? []).map((image, index) => (
        <div
          key={image.id}
          className="absolute"
          style={pptxImageStyle(image, (slide.shapes?.length ?? 0) + index + 1)}
        >
          <PptxImageView image={image} />
        </div>
      ))}
      {(slide.charts ?? []).map((chart, index) => (
        <div
          key={chart.id}
          className="absolute"
          style={pptxChartStyle(
            chart,
            (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              index +
              1,
          )}
        >
          <PptxChartView chart={chart} />
        </div>
      ))}
      {(slide.tables ?? []).map((table, index) => (
        <PptxTableView
          key={table.id}
          table={table}
          zIndex={
            (slide.shapes?.length ?? 0) +
            (slide.images?.length ?? 0) +
            (slide.charts?.length ?? 0) +
            index +
            1
          }
        />
      ))}
      {slide.texts.map((textItem, index) => (
        <div
          key={textItem.id}
          className="absolute whitespace-pre-wrap text-neutral-950"
          style={{
            left: `${textItem.x ?? 10}%`,
            top: `${textItem.y ?? 12 + index * 18}%`,
            width: `${textItem.width ?? 80}%`,
            height: `${textItem.height ?? 10}%`,
            transform: `rotate(${textItem.rotation ?? 0}deg)`,
            zIndex:
              (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              (slide.charts?.length ?? 0) +
              (slide.tables?.length ?? 0) +
              index +
              1,
            fontFamily: textItem.fontFamily ?? builtInFontFamilies[0],
            fontSize: `${textItem.fontSize ?? (index === 0 ? "28" : "18")}px`,
            fontWeight: textItem.bold ? 700 : index === 0 ? 600 : 400,
            fontStyle: textItem.italic ? "italic" : undefined,
            textDecorationLine: [
              textItem.underline ? "underline" : "",
              textItem.strikethrough ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" "),
            textAlign: textItem.align ?? "left",
            color: textItem.color,
            backgroundColor: textItem.fillColor,
          }}
        >
          {textItem.text}
        </div>
      ))}
    </div>
  );
}
