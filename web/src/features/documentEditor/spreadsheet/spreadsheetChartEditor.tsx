import type { XlsxChart, XlsxChartSeries } from "../shared/models";

const XLSX_CHART_TYPES = ["bar", "line", "area", "pie", "doughnut"] as const;
const XLSX_LEGEND_POSITIONS = ["r", "l", "t", "b", "tr"] as const;
const XLSX_TICK_LABEL_POSITIONS = ["nextTo", "low", "high", "none"] as const;
const XLSX_TICK_MARKS = ["cross", "in", "out", "none"] as const;
const XLSX_LINE_DASHES = ["solid", "dash", "dot", "dashDot"] as const;

const LEGEND_LABELS: Record<string, string> = {
  r: "Right",
  l: "Left",
  t: "Top",
  b: "Bottom",
  tr: "Top right",
};

/**
 * XLSX charts share the OOXML chart part format with presentations, but the
 * workbook editor surfaces them as sheet objects. Keeping this editor separate
 * from the generic sheet object strip prevents chart-specific axis, legend, and
 * cached-series controls from making the sheet panel own chart mutation rules.
 */
export function SpreadsheetChartEditor({
  chart,
  onChange,
  canAddSeriesFromSelection,
  onAddSeriesFromSelection,
  onSeriesChange,
  onSeriesNameChange,
  onPointChange,
}: {
  chart: XlsxChart;
  onChange: (patch: Partial<XlsxChart>) => void;
  canAddSeriesFromSelection: boolean;
  onAddSeriesFromSelection: () => void;
  onSeriesChange: (
    seriesIndex: number,
    patch: Partial<XlsxChartSeries>,
  ) => void;
  onSeriesNameChange: (seriesIndex: number, value: string) => void;
  onPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
}) {
  const typeOptions = optionList(chart.type, XLSX_CHART_TYPES);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="mb-2 grid gap-2 md:grid-cols-[minmax(12rem,1fr)_minmax(8rem,0.55fr)_minmax(11rem,0.7fr)]">
        <SpreadsheetChartTextInput
          label="Chart title"
          value={chart.title ?? ""}
          onChange={(value) => onChange({ title: value })}
        />
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Type
          </span>
          <select
            value={chart.type ?? ""}
            onChange={(event) =>
              onChange({ type: event.currentTarget.value || undefined })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="">Inherit</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {chartTypeLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Legend
          </span>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1">
            <label className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={chart.legendVisible !== false}
                onChange={(event) =>
                  onChange({ legendVisible: event.currentTarget.checked })
                }
              />
            </label>
            <select
              value={chart.legendPosition ?? "r"}
              onChange={(event) =>
                onChange({
                  legendVisible: true,
                  legendPosition: event.currentTarget
                    .value as XlsxChart["legendPosition"],
                })
              }
              disabled={chart.legendVisible === false}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            >
              {XLSX_LEGEND_POSITIONS.map((option) => (
                <option key={option} value={option}>
                  {LEGEND_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="mb-2 grid gap-2 lg:grid-cols-2">
        <SpreadsheetChartAxisEditor
          axis="category"
          chart={chart}
          onChange={onChange}
        />
        <SpreadsheetChartAxisEditor
          axis="value"
          chart={chart}
          onChange={onChange}
        />
      </div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={onAddSeriesFromSelection}
          disabled={!canAddSeriesFromSelection}
          className="h-8 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Add series from selection
        </button>
      </div>
      {(chart.series ?? []).length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
          No chart data
        </div>
      ) : (
        <div className="grid gap-2">
          {(chart.series ?? []).map((series, seriesIndex) => {
            const rowCount = Math.max(
              series.categories?.length ?? 0,
              series.values?.length ?? 0,
              chart.categories?.length ?? 0,
            );
            return (
              <div key={`${series.name ?? "series"}-${seriesIndex}`}>
                <input
                  value={series.name ?? ""}
                  onChange={(event) =>
                    onSeriesNameChange(seriesIndex, event.target.value)
                  }
                  className="mb-1 h-7 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
                <div className="mb-1 grid gap-1 md:grid-cols-3">
                  <SpreadsheetChartTextInput
                    label="Name ref"
                    value={series.nameFormula ?? ""}
                    mono
                    onChange={(value) =>
                      onSeriesChange(seriesIndex, {
                        nameFormula: value || undefined,
                      })
                    }
                  />
                  <SpreadsheetChartTextInput
                    label="Category ref"
                    value={series.categoriesFormula ?? ""}
                    mono
                    onChange={(value) =>
                      onSeriesChange(seriesIndex, {
                        categoriesFormula: value || undefined,
                      })
                    }
                  />
                  <SpreadsheetChartTextInput
                    label="Value ref"
                    value={series.valuesFormula ?? ""}
                    mono
                    onChange={(value) =>
                      onSeriesChange(seriesIndex, {
                        valuesFormula: value || undefined,
                      })
                    }
                  />
                </div>
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="text-left text-[11px] text-[var(--text-muted)]">
                      <th className="border border-[var(--border)] px-2 py-1 font-medium">
                        Category
                      </th>
                      <th className="border border-[var(--border)] px-2 py-1 font-medium">
                        Value
                      </th>
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
                            className="h-7 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
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
                            className="h-7 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpreadsheetChartAxisEditor({
  axis,
  chart,
  onChange,
}: {
  axis: "category" | "value";
  chart: XlsxChart;
  onChange: (patch: Partial<XlsxChart>) => void;
}) {
  const config = chartAxisConfig(axis);
  const patch = <K extends keyof XlsxChart>(key: K, value: XlsxChart[K]) => {
    onChange({ [key]: value } as Partial<XlsxChart>);
  };
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
      <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(7rem,0.6fr)_minmax(7rem,0.6fr)]">
        <SpreadsheetChartTextInput
          label={`${config.label} title`}
          value={(chart[config.titleKey] as string | undefined) ?? ""}
          onChange={(value) => patch(config.titleKey, value)}
        />
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Position
          </span>
          <select
            value={(chart[config.positionKey] as string | undefined) ?? ""}
            onChange={(event) =>
              patch(
                config.positionKey,
                (event.currentTarget.value || undefined) as never,
              )
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="">Inherit</option>
            {config.positionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Labels
          </span>
          <select
            value={(chart[config.tickLabelKey] as string | undefined) ?? ""}
            onChange={(event) =>
              patch(
                config.tickLabelKey,
                (event.currentTarget.value || undefined) as never,
              )
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="">Inherit</option>
            {XLSX_TICK_LABEL_POSITIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={chart[config.gridlinesKey] === true}
            onChange={(event) =>
              patch(config.gridlinesKey, event.currentTarget.checked)
            }
          />
          Gridlines
        </label>
        <SpreadsheetChartSelect
          label="Major tick"
          value={(chart[config.majorTickKey] as string | undefined) ?? ""}
          options={XLSX_TICK_MARKS}
          onChange={(value) => patch(config.majorTickKey, value as never)}
        />
        <SpreadsheetChartSelect
          label="Minor tick"
          value={(chart[config.minorTickKey] as string | undefined) ?? ""}
          options={XLSX_TICK_MARKS}
          onChange={(value) => patch(config.minorTickKey, value as never)}
        />
        <SpreadsheetChartSelect
          label="Line"
          value={(chart[config.lineDashKey] as string | undefined) ?? ""}
          options={XLSX_LINE_DASHES}
          onChange={(value) => patch(config.lineDashKey, value as never)}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <SpreadsheetChartTextInput
          label="Number format"
          value={(chart[config.numberFormatKey] as string | undefined) ?? ""}
          onChange={(value) => patch(config.numberFormatKey, value)}
          mono
        />
        <SpreadsheetChartTextInput
          label="Line color"
          value={(chart[config.lineColorKey] as string | undefined) ?? ""}
          onChange={(value) => patch(config.lineColorKey, value)}
        />
        <SpreadsheetChartNumberInput
          label="Line width"
          value={chart[config.lineWidthKey] as number | undefined}
          onChange={(value) => patch(config.lineWidthKey, value as never)}
        />
        <SpreadsheetChartTextInput
          label="Label color"
          value={(chart[config.labelColorKey] as string | undefined) ?? ""}
          onChange={(value) => patch(config.labelColorKey, value)}
        />
        <SpreadsheetChartNumberInput
          label="Label size"
          value={chart[config.labelFontSizeKey] as number | undefined}
          onChange={(value) => patch(config.labelFontSizeKey, value as never)}
        />
        <SpreadsheetChartNumberInput
          label="Label rotation"
          value={chart[config.labelRotationKey] as number | undefined}
          onChange={(value) => patch(config.labelRotationKey, value as never)}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <SpreadsheetChartToggle
          label="Bold"
          checked={chart[config.labelBoldKey] === true}
          onChange={(value) => patch(config.labelBoldKey, value)}
        />
        <SpreadsheetChartToggle
          label="Italic"
          checked={chart[config.labelItalicKey] === true}
          onChange={(value) => patch(config.labelItalicKey, value)}
        />
      </div>
    </div>
  );
}

function SpreadsheetChartTextInput({
  label,
  value,
  onChange,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function SpreadsheetChartNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          onChange(event.currentTarget.value === "" || Number.isNaN(next) ? undefined : next);
        }}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function SpreadsheetChartSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value || undefined)}
        className="h-6 bg-transparent text-xs text-[var(--text)] outline-none"
      >
        <option value="">Inherit</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SpreadsheetChartToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function chartAxisConfig(axis: "category" | "value") {
  return axis === "category"
    ? {
        label: "Category axis",
        titleKey: "categoryAxisTitle" as const,
        positionKey: "categoryAxisPosition" as const,
        positionOptions: [
          { value: "b", label: "Bottom" },
          { value: "t", label: "Top" },
        ],
        gridlinesKey: "categoryMajorGridlines" as const,
        tickLabelKey: "categoryAxisTickLabelPosition" as const,
        majorTickKey: "categoryAxisMajorTickMark" as const,
        minorTickKey: "categoryAxisMinorTickMark" as const,
        numberFormatKey: "categoryAxisNumberFormat" as const,
        lineColorKey: "categoryAxisLineColor" as const,
        lineWidthKey: "categoryAxisLineWidth" as const,
        lineDashKey: "categoryAxisLineDash" as const,
        labelColorKey: "categoryAxisLabelTextColor" as const,
        labelFontSizeKey: "categoryAxisLabelFontSize" as const,
        labelRotationKey: "categoryAxisLabelRotation" as const,
        labelBoldKey: "categoryAxisLabelBold" as const,
        labelItalicKey: "categoryAxisLabelItalic" as const,
      }
    : {
        label: "Value axis",
        titleKey: "valueAxisTitle" as const,
        positionKey: "valueAxisPosition" as const,
        positionOptions: [
          { value: "l", label: "Left" },
          { value: "r", label: "Right" },
        ],
        gridlinesKey: "valueMajorGridlines" as const,
        tickLabelKey: "valueAxisTickLabelPosition" as const,
        majorTickKey: "valueAxisMajorTickMark" as const,
        minorTickKey: "valueAxisMinorTickMark" as const,
        numberFormatKey: "valueAxisNumberFormat" as const,
        lineColorKey: "valueAxisLineColor" as const,
        lineWidthKey: "valueAxisLineWidth" as const,
        lineDashKey: "valueAxisLineDash" as const,
        labelColorKey: "valueAxisLabelTextColor" as const,
        labelFontSizeKey: "valueAxisLabelFontSize" as const,
        labelRotationKey: "valueAxisLabelRotation" as const,
        labelBoldKey: "valueAxisLabelBold" as const,
        labelItalicKey: "valueAxisLabelItalic" as const,
      };
}

function optionList<T extends string>(
  current: string | undefined,
  options: readonly T[],
) {
  return current && !options.includes(current as T)
    ? [current, ...options]
    : [...options];
}

function chartTypeLabel(type: string) {
  return type
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}
