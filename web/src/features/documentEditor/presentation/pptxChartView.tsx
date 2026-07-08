import type { CSSProperties } from "react";
import { ChartColumn } from "lucide-react";
import type { PptxChart } from "../shared/models";

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
