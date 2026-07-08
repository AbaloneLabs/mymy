import { ChartColumn, Plus, Trash2 } from "lucide-react";
import type { PptxChart } from "../shared/models";
import { PptxAxisStyleControls } from "./pptxChartAxisControls";

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
