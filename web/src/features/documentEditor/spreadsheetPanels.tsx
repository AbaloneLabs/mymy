import type { ComponentType } from "react";
import { BarChart3, ImageIcon, Table } from "lucide-react";
import type {
  XlsxChart,
  XlsxChartSeries,
  XlsxImage,
  XlsxPivot,
  XlsxPivotDataField,
  XlsxPivotField,
  XlsxSheet,
  XlsxTable,
  XlsxTableColumn,
} from "./models";
import {
  formatNumber,
  xlsxAnchorLabel,
  xlsxChartLabel,
  xlsxPivotLabel,
  xlsxTableDetail,
  xlsxTableLabel,
} from "./spreadsheetPresentation";
import { SpreadsheetChartEditor } from "./spreadsheetChartEditor";
import type { NormalizedCellRange } from "./spreadsheetGeometry";

/**
 * Spreadsheet panels are render-only surfaces for workbook metadata and grid
 * virtualization. They sit outside the core editor so the editing component can
 * focus on workbook mutation, selection, and command routing rather than
 * carrying every secondary panel in the same render tree definition.
 */
export function SpreadsheetStatusBar({
  summary,
}: {
  summary: { cells: number; numeric: number; sum: number; average: number | null };
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
      <span>Cells {summary.cells}</span>
      <span>Count {summary.numeric}</span>
      <span>Sum {formatNumber(summary.sum)}</span>
      <span>Average {summary.average === null ? "-" : formatNumber(summary.average)}</span>
    </div>
  );
}

export function SpreadsheetObjectStrip({
  sheet,
  selectionRange,
  onTableChange,
  onTableColumnChange,
  onTableResizeToSelection,
  onTableInferHeaders,
  onChartChange,
  canAddChartSeriesFromSelection,
  onChartAddSeriesFromSelection,
  onChartSeriesChange,
  onChartSeriesNameChange,
  onChartPointChange,
  onPivotNameChange,
  onPivotFieldChange,
  onPivotDataFieldChange,
}: {
  sheet: XlsxSheet | undefined;
  selectionRange: NormalizedCellRange | null;
  onTableChange: (tableId: string, patch: Partial<XlsxTable>) => void;
  onTableColumnChange: (
    tableId: string,
    columnIndex: number,
    patch: Partial<XlsxTableColumn>,
  ) => void;
  onTableResizeToSelection: (tableId: string) => void;
  onTableInferHeaders: (tableId: string) => void;
  onChartChange: (chartId: string, patch: Partial<XlsxChart>) => void;
  canAddChartSeriesFromSelection: boolean;
  onChartAddSeriesFromSelection: (chartId: string) => void;
  onChartSeriesChange: (
    chartId: string,
    seriesIndex: number,
    patch: Partial<XlsxChartSeries>,
  ) => void;
  onChartSeriesNameChange: (
    chartId: string,
    seriesIndex: number,
    value: string,
  ) => void;
  onChartPointChange: (
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
  onPivotNameChange: (pivotId: string, name: string) => void;
  onPivotFieldChange: (
    pivotId: string,
    fieldIndex: number,
    patch: Partial<XlsxPivotField>,
  ) => void;
  onPivotDataFieldChange: (
    pivotId: string,
    fieldIndex: number,
    patch: Partial<XlsxPivotDataField>,
  ) => void;
}) {
  const tables = sheet?.tables ?? [];
  const charts = sheet?.charts ?? [];
  const images = sheet?.images ?? [];
  const pivots = sheet?.pivots ?? [];
  if (
    tables.length === 0 &&
    charts.length === 0 &&
    images.length === 0 &&
    pivots.length === 0
  ) {
    return null;
  }
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {tables.map((table) => (
          <SpreadsheetObjectChip
            key={`table:${table.id}:${table.path ?? ""}`}
            icon={Table}
            label={xlsxTableLabel(table)}
            detail={xlsxTableDetail(table)}
          />
        ))}
        {charts.map((chart) => (
          <SpreadsheetObjectChip
            key={`chart:${chart.id}:${chart.path ?? ""}`}
            icon={BarChart3}
            label={xlsxChartLabel(chart)}
            detail={xlsxAnchorLabel(chart.anchor)}
          />
        ))}
        {images.map((image) => (
          <SpreadsheetImageChip
            key={`image:${image.id}:${image.mediaPath ?? ""}`}
            image={image}
          />
        ))}
        {pivots.map((pivot) => (
          <SpreadsheetObjectChip
            key={`pivot:${pivot.id}:${pivot.path ?? ""}`}
            icon={Table}
            label={xlsxPivotLabel(pivot)}
            detail={pivot.path}
          />
        ))}
      </div>
      {(tables.length > 0 || charts.length > 0 || pivots.length > 0) && (
        <div className="max-h-64 overflow-auto border-t border-[var(--border)] px-3 py-2">
          <div className="grid gap-2">
            {tables.map((table) => (
              <SpreadsheetTableEditor
                key={`table-editor:${table.id}:${table.path ?? ""}`}
                table={table}
                canResizeToSelection={Boolean(selectionRange)}
                onChange={(patch) => onTableChange(table.id, patch)}
                onColumnChange={(columnIndex, patch) =>
                  onTableColumnChange(table.id, columnIndex, patch)
                }
                onResizeToSelection={() => onTableResizeToSelection(table.id)}
                onInferHeaders={() => onTableInferHeaders(table.id)}
              />
            ))}
            {charts.map((chart) => (
              <SpreadsheetChartEditor
                key={`chart-editor:${chart.id}:${chart.path ?? ""}`}
                chart={chart}
                onChange={(patch) => onChartChange(chart.id, patch)}
                canAddSeriesFromSelection={canAddChartSeriesFromSelection}
                onAddSeriesFromSelection={() =>
                  onChartAddSeriesFromSelection(chart.id)
                }
                onSeriesChange={(seriesIndex, patch) =>
                  onChartSeriesChange(chart.id, seriesIndex, patch)
                }
                onSeriesNameChange={(seriesIndex, value) =>
                  onChartSeriesNameChange(chart.id, seriesIndex, value)
                }
                onPointChange={(seriesIndex, pointIndex, key, value) =>
                  onChartPointChange(chart.id, seriesIndex, pointIndex, key, value)
                }
              />
            ))}
            {pivots.map((pivot) => (
              <SpreadsheetPivotEditor
                key={`pivot-editor:${pivot.id}:${pivot.path ?? ""}`}
                pivot={pivot}
                onNameChange={(name) => onPivotNameChange(pivot.id, name)}
                onFieldChange={(fieldIndex, patch) =>
                  onPivotFieldChange(pivot.id, fieldIndex, patch)
                }
                onDataFieldChange={(fieldIndex, patch) =>
                  onPivotDataFieldChange(pivot.id, fieldIndex, patch)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const XLSX_TABLE_STYLE_NAMES = [
  "TableStyleMedium2",
  "TableStyleMedium4",
  "TableStyleMedium9",
  "TableStyleLight1",
  "TableStyleLight9",
  "TableStyleDark2",
  "TableStyleDark11",
];

const XLSX_TOTALS_ROW_FUNCTIONS = [
  "",
  "sum",
  "average",
  "count",
  "countNums",
  "min",
  "max",
  "stdDev",
  "var",
  "custom",
  "none",
];

const XLSX_PIVOT_AXIS_OPTIONS = [
  ["", "Hidden"],
  ["axisRow", "Rows"],
  ["axisCol", "Columns"],
  ["axisPage", "Filters"],
  ["axisValues", "Values"],
] as const;

const XLSX_PIVOT_SUBTOTAL_OPTIONS = [
  ["", "Default"],
  ["sum", "Sum"],
  ["count", "Count"],
  ["countA", "Count non-empty"],
  ["average", "Average"],
  ["max", "Max"],
  ["min", "Min"],
  ["product", "Product"],
  ["stdDev", "StdDev"],
  ["stdDevP", "StdDevP"],
  ["var", "Variance"],
  ["varP", "Variance P"],
] as const;

function SpreadsheetTableEditor({
  table,
  canResizeToSelection,
  onChange,
  onColumnChange,
  onResizeToSelection,
  onInferHeaders,
}: {
  table: XlsxTable;
  canResizeToSelection: boolean;
  onChange: (patch: Partial<XlsxTable>) => void;
  onColumnChange: (columnIndex: number, patch: Partial<XlsxTableColumn>) => void;
  onResizeToSelection: () => void;
  onInferHeaders: () => void;
}) {
  const styleName = table.tableStyleName ?? "";
  const styleOptions = XLSX_TABLE_STYLE_NAMES.includes(styleName) || !styleName
    ? XLSX_TABLE_STYLE_NAMES
    : [styleName, ...XLSX_TABLE_STYLE_NAMES];
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="mb-2 grid gap-2 md:grid-cols-[minmax(9rem,0.8fr)_minmax(9rem,0.8fr)_minmax(8rem,0.7fr)_minmax(9rem,0.7fr)]">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Name
          </span>
          <input
            value={table.name ?? ""}
            onChange={(event) => onChange({ name: event.currentTarget.value })}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Display
          </span>
          <input
            value={table.displayName ?? ""}
            onChange={(event) =>
              onChange({ displayName: event.currentTarget.value })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Range
          </span>
          <input
            value={table.ref ?? ""}
            onChange={(event) => onChange({ ref: event.currentTarget.value })}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Filter
          </span>
          <input
            value={table.autoFilterRef ?? table.ref ?? ""}
            onChange={(event) =>
              onChange({ autoFilterRef: event.currentTarget.value })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onResizeToSelection}
          disabled={!canResizeToSelection}
          className="h-8 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Resize to selection
        </button>
        <button
          type="button"
          onClick={onInferHeaders}
          className="h-8 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          Use first row as headers
        </button>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={table.totalsRowShown === true}
            onChange={(event) =>
              onChange({ totalsRowShown: event.currentTarget.checked })
            }
          />
          Totals row
        </label>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-muted)]">
          Style
          <select
            value={styleName}
            onChange={(event) =>
              onChange({ tableStyleName: event.currentTarget.value || undefined })
            }
            className="h-6 bg-transparent text-xs text-[var(--text)] outline-none"
          >
            <option value="">None</option>
            {styleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <SpreadsheetTableToggle
          label="First column"
          checked={table.showFirstColumn === true}
          onChange={(value) => onChange({ showFirstColumn: value })}
        />
        <SpreadsheetTableToggle
          label="Last column"
          checked={table.showLastColumn === true}
          onChange={(value) => onChange({ showLastColumn: value })}
        />
        <SpreadsheetTableToggle
          label="Row stripes"
          checked={table.showRowStripes !== false}
          onChange={(value) => onChange({ showRowStripes: value })}
        />
        <SpreadsheetTableToggle
          label="Column stripes"
          checked={table.showColumnStripes === true}
          onChange={(value) => onChange({ showColumnStripes: value })}
        />
      </div>
      {(table.columns ?? []).length > 0 && (
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="text-left text-[11px] text-[var(--text-muted)]">
              <th className="w-20 border border-[var(--border)] px-2 py-1 font-medium">
                ID
              </th>
              <th className="border border-[var(--border)] px-2 py-1 font-medium">
                Column
              </th>
              <th className="w-36 border border-[var(--border)] px-2 py-1 font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {(table.columns ?? []).map((column, columnIndex) => (
              <tr key={`${column.id ?? columnIndex}:${columnIndex}`}>
                <td className="border border-[var(--border)] px-2 py-1 font-mono text-[11px] text-[var(--text-faint)]">
                  {column.id ?? columnIndex + 1}
                </td>
                <td className="border border-[var(--border)] p-0">
                  <input
                    value={column.name ?? ""}
                    onChange={(event) =>
                      onColumnChange(columnIndex, {
                        name: event.currentTarget.value,
                      })
                    }
                    className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                  />
                </td>
                <td className="border border-[var(--border)] p-0">
                  <select
                    value={column.totalsRowFunction ?? ""}
                    onChange={(event) =>
                      onColumnChange(columnIndex, {
                        totalsRowFunction:
                          event.currentTarget.value || undefined,
                      })
                    }
                    className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                  >
                    {XLSX_TOTALS_ROW_FUNCTIONS.map((functionName) => (
                      <option key={functionName || "blank"} value={functionName}>
                        {functionName || "None"}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SpreadsheetTableToggle({
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

function SpreadsheetPivotEditor({
  pivot,
  onNameChange,
  onFieldChange,
  onDataFieldChange,
}: {
  pivot: XlsxPivot;
  onNameChange: (name: string) => void;
  onFieldChange: (
    fieldIndex: number,
    patch: Partial<XlsxPivotField>,
  ) => void;
  onDataFieldChange: (
    fieldIndex: number,
    patch: Partial<XlsxPivotDataField>,
  ) => void;
}) {
  const fields = pivot.fields ?? [];
  const dataFields = pivot.dataFields ?? [];
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Pivot name
          </span>
          <input
            value={pivot.name ?? ""}
            onChange={(event) => onNameChange(event.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-end text-[11px] text-[var(--text-muted)]">
          {pivot.cacheId ? `cache ${pivot.cacheId}` : pivot.path}
        </div>
      </div>
      {fields.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="grid min-w-[48rem] grid-cols-[minmax(9rem,1.4fr)_8rem_5rem_6rem_8rem] gap-2 border-t border-[var(--border)] pt-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Field
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Axis
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Items
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Subtotal
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Function
            </div>
            {fields.map((field) => (
              <PivotFieldRow
                key={`pivot-field:${pivot.id}:${field.index}`}
                field={field}
                onChange={(patch) => onFieldChange(field.index, patch)}
              />
            ))}
          </div>
        </div>
      )}
      {dataFields.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <div className="grid min-w-[28rem] grid-cols-[minmax(10rem,1fr)_9rem] gap-2 border-t border-[var(--border)] pt-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Data field
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Function
            </div>
            {dataFields.map((field) => (
              <PivotDataFieldRow
                key={`pivot-data-field:${pivot.id}:${field.fieldIndex}`}
                field={field}
                onChange={(patch) =>
                  onDataFieldChange(field.fieldIndex, patch)
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PivotFieldRow({
  field,
  onChange,
}: {
  field: XlsxPivotField;
  onChange: (patch: Partial<XlsxPivotField>) => void;
}) {
  return (
    <>
      <div className="flex h-8 items-center truncate rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text)]">
        {field.name || `Field ${field.index + 1}`}
      </div>
      <select
        value={field.axis ?? ""}
        onChange={(event) => {
          const axis = event.currentTarget.value as XlsxPivotField["axis"] | "";
          onChange({
            axis: axis || undefined,
            dataField: axis === "axisValues",
          });
        }}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      >
        {XLSX_PIVOT_AXIS_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label className="flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <input
          type="checkbox"
          checked={field.showAll ?? true}
          onChange={(event) =>
            onChange({ showAll: event.currentTarget.checked })
          }
        />
      </label>
      <label className="flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <input
          type="checkbox"
          checked={field.defaultSubtotal ?? true}
          onChange={(event) =>
            onChange({ defaultSubtotal: event.currentTarget.checked })
          }
        />
      </label>
      <select
        value={field.subtotal ?? ""}
        onChange={(event) =>
          onChange({ subtotal: event.currentTarget.value || undefined })
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      >
        {XLSX_PIVOT_SUBTOTAL_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}

function PivotDataFieldRow({
  field,
  onChange,
}: {
  field: XlsxPivotDataField;
  onChange: (patch: Partial<XlsxPivotDataField>) => void;
}) {
  return (
    <>
      <input
        value={field.name ?? ""}
        onChange={(event) => onChange({ name: event.currentTarget.value })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <select
        value={field.subtotal ?? ""}
        onChange={(event) =>
          onChange({ subtotal: event.currentTarget.value || undefined })
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      >
        {XLSX_PIVOT_SUBTOTAL_OPTIONS.filter(([value]) => value !== "").map(
          ([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ),
        )}
      </select>
    </>
  );
}

function SpreadsheetObjectChip({
  icon: Icon,
  label,
  detail,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail?: string;
}) {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
      title={[label, detail].filter(Boolean).join(" · ")}
    >
      <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="max-w-44 truncate text-[var(--text)]">{label}</div>
        {detail && (
          <div className="max-w-44 truncate text-[10px] text-[var(--text-faint)]">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function SpreadsheetImageChip({ image }: { image: XlsxImage }) {
  const anchor = xlsxAnchorLabel(image.anchor);
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
      title={[image.mediaPath, anchor].filter(Boolean).join(" · ")}
    >
      {image.dataUrl ? (
        <img
          src={image.dataUrl}
          alt=""
          className="h-7 w-7 rounded border border-[var(--border)] object-cover"
        />
      ) : (
        <ImageIcon className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
      )}
      <div className="min-w-0">
        <div className="max-w-44 truncate text-[var(--text)]">
          {image.mediaPath ?? image.id}
        </div>
        {anchor && (
          <div className="max-w-44 truncate text-[10px] text-[var(--text-faint)]">
            {anchor}
          </div>
        )}
      </div>
    </div>
  );
}

export function SpreadsheetSpacerRow({
  height,
  columnSpan,
}: {
  height: number;
  columnSpan: number;
}) {
  return (
    <tr aria-hidden="true" style={{ height }}>
      <th className="sticky left-0 z-10 border-0 bg-[var(--surface)] p-0" />
      <td className="border-0 p-0" colSpan={Math.max(1, columnSpan)} />
    </tr>
  );
}

export function SpreadsheetColumnSpacer({ width }: { width: number }) {
  return (
    <td
      aria-hidden="true"
      className="border border-transparent p-0"
      style={{ minWidth: width, width }}
    />
  );
}
