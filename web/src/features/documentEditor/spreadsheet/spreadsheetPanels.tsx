import { BarChart3, Table } from "lucide-react";
import type {
  XlsxChart,
  XlsxChartSeries,
  XlsxPivotDataField,
  XlsxPivotField,
  XlsxSheet,
  XlsxTable,
  XlsxTableColumn,
} from "../shared/models";
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
import {
  SpreadsheetImageChip,
  SpreadsheetObjectChip,
} from "./spreadsheetObjectChips";
import { SpreadsheetPivotEditor } from "./spreadsheetPivotPanels";
import { SpreadsheetTableEditor } from "./spreadsheetTablePanels";

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
  readOnly,
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
  readOnly: boolean;
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
        <fieldset
          disabled={readOnly}
          className="max-h-64 overflow-auto border-t border-[var(--border)] px-3 py-2 disabled:opacity-60"
        >
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
        </fieldset>
      )}
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
