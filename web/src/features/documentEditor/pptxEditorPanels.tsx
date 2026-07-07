import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useState } from "react";
import {
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Layers,
  Move,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { builtInFontFamilies } from "./fonts";
import type {
  PptxAnimation,
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";
import {
  animationLabel,
  pptxChartStyle,
  pptxImageStyle,
  pptxTableStyle,
} from "./pptxEditorUtils";

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
    </div>
  );
}

export function PercentInput({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={Math.round(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-14 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function PptxShapeView({ shape }: { shape: PptxShape }) {
  const strokeWidth = Math.max(0, shape.strokeWidth ?? 2);
  const strokeColor = shape.strokeColor ?? "#111827";
  if (shape.kind === "line") {
    return (
      <div className="relative h-full w-full">
        <div
          className="absolute left-0 top-1/2 w-full -translate-y-1/2"
          style={{
            borderTop: `${Math.max(1, strokeWidth)}px solid ${strokeColor}`,
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="h-full w-full"
      style={{
        backgroundColor: shape.fillColor ?? "transparent",
        border: `${strokeWidth}px solid ${strokeColor}`,
        borderRadius: shape.kind === "ellipse" ? "9999px" : "4px",
      }}
    />
  );
}

export function PptxImageView({ image }: { image: PptxImage }) {
  if (!image.dataUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 px-2 text-center text-[10px] text-neutral-500">
        {image.mediaPath ?? "Image"}
      </div>
    );
  }
  return (
    <img
      src={image.dataUrl}
      alt={image.altText ?? image.mediaPath ?? "Slide image"}
      draggable={false}
      className="h-full w-full object-contain"
    />
  );
}

export function PptxChartDataEditor({
  chart,
  onSeriesNameChange,
  onPointChange,
  onAddSeries,
  onDeleteSeries,
  onAddPoint,
  onDeletePoint,
}: {
  chart: PptxChart;
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
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
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

export function PptxChartView({ chart }: { chart: PptxChart }) {
  const values = (chart.series ?? [])
    .flatMap((series) => series.values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));

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
        <div className="grid min-h-0 flex-1 gap-1 overflow-hidden">
          {(chart.series ?? []).slice(0, 4).map((series, seriesIndex) => (
            <div key={`${series.name ?? "series"}-${seriesIndex}`} className="min-h-0">
              <div className="truncate text-[10px] text-neutral-500">
                {series.name ?? `Series ${seriesIndex + 1}`}
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
    </div>
  );
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
}) {
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  const canDeleteRow = table.rows.length > 1;
  const canDeleteColumn = columnCount > 1;

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
        </div>
      )}
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td key={columnIndex} className="border border-neutral-300 p-0">
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
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className="whitespace-pre-wrap border border-neutral-300 px-1 py-0.5 align-top"
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

export function PptxReadOnlySlide({ slide }: { slide: PptxSlide }) {
  return (
    <div
      className="relative aspect-video w-full max-w-6xl overflow-hidden shadow-2xl"
      style={{ backgroundColor: slide.backgroundColor ?? "#ffffff" }}
    >
      {(slide.shapes ?? []).map((shape, index) => (
        <div
          key={shape.id}
          className="absolute"
          style={{
            left: `${shape.x ?? 24}%`,
            top: `${shape.y ?? 34}%`,
            width: `${shape.width ?? 26}%`,
            height: `${shape.kind === "line" ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
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
