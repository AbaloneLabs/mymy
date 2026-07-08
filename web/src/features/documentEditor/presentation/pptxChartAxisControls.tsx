import { cn } from "@/lib/utils";
import type { PptxChart } from "../shared/models";

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

export function PptxAxisStyleControls({
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
