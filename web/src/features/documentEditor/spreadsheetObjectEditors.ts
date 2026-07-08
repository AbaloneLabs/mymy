import type {
  XlsxChart,
  XlsxChartSeries,
  XlsxModel,
  XlsxPivot,
  XlsxPivotDataField,
  XlsxPivotField,
  XlsxSheet,
  XlsxTable,
  XlsxTableColumn,
} from "./models";

/**
 * Sheet object editing is intentionally kept outside the grid editor component.
 * Tables, charts, and pivots are workbook metadata backed by separate OOXML
 * parts, so their mutation path should stay independent from cell selection and
 * paste/fill behavior in the main spreadsheet grid.
 */
export function createSpreadsheetObjectEditors({
  sheet,
  model,
  commitXlsxModel,
}: {
  sheet: XlsxSheet | undefined;
  model: XlsxModel;
  commitXlsxModel: (next: XlsxModel) => void;
}) {
  function updateSheetTables(updater: (tables: XlsxTable[]) => XlsxTable[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, tables: updater(item.tables ?? []) }
          : item,
      ),
    });
  }

  function updateTable(tableId: string, patch: Partial<XlsxTable>) {
    updateSheetTables((tables) =>
      tables.map((table) =>
        table.id === tableId ? { ...table, ...patch } : table,
      ),
    );
  }

  function updateTableColumn(
    tableId: string,
    columnIndex: number,
    patch: Partial<XlsxTableColumn>,
  ) {
    updateSheetTables((tables) =>
      tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: (table.columns ?? []).map((column, currentIndex) =>
                currentIndex === columnIndex ? { ...column, ...patch } : column,
              ),
            }
          : table,
      ),
    );
  }

  function updateSheetCharts(updater: (charts: XlsxChart[]) => XlsxChart[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, charts: updater(item.charts ?? []) }
          : item,
      ),
    });
  }

  function updateChart(chartId: string, patch: Partial<XlsxChart>) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId ? { ...chart, ...patch } : chart,
      ),
    );
  }

  function updateChartSeriesName(
    chartId: string,
    seriesIndex: number,
    value: string,
  ) {
    updateChartSeries(chartId, seriesIndex, { name: value });
  }

  function updateChartSeries(
    chartId: string,
    seriesIndex: number,
    patch: Partial<XlsxChartSeries>,
  ) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId
          ? {
              ...chart,
              series: (chart.series ?? []).map((series, currentIndex) =>
                currentIndex === seriesIndex ? { ...series, ...patch } : series,
              ),
            }
          : chart,
      ),
    );
  }

  function updateChartSeriesPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId
          ? {
              ...chart,
              series: (chart.series ?? []).map((series, currentIndex) => {
                if (currentIndex !== seriesIndex) return series;
                const nextValues = [...(series[key] ?? [])];
                nextValues[pointIndex] = value;
                return { ...series, [key]: nextValues };
              }),
            }
          : chart,
      ),
    );
  }

  function addChartSeries(chartId: string, series: XlsxChartSeries) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId
          ? { ...chart, series: [...(chart.series ?? []), series] }
          : chart,
      ),
    );
  }

  function updateSheetPivots(updater: (pivots: XlsxPivot[]) => XlsxPivot[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, pivots: updater(item.pivots ?? []) }
          : item,
      ),
    });
  }

  function updatePivotName(pivotId: string, name: string) {
    updateSheetPivots((pivots) =>
      pivots.map((pivot) =>
        pivot.id === pivotId ? { ...pivot, name } : pivot,
      ),
    );
  }

  function updatePivotField(
    pivotId: string,
    fieldIndex: number,
    patch: Partial<XlsxPivotField>,
  ) {
    updateSheetPivots((pivots) =>
      pivots.map((pivot) =>
        pivot.id === pivotId
          ? {
              ...pivot,
              fields: (pivot.fields ?? []).map((field) =>
                field.index === fieldIndex ? { ...field, ...patch } : field,
              ),
            }
          : pivot,
      ),
    );
  }

  function updatePivotDataField(
    pivotId: string,
    fieldIndex: number,
    patch: Partial<XlsxPivotDataField>,
  ) {
    updateSheetPivots((pivots) =>
      pivots.map((pivot) =>
        pivot.id === pivotId
          ? {
              ...pivot,
              dataFields: (pivot.dataFields ?? []).map((field) =>
                field.fieldIndex === fieldIndex ? { ...field, ...patch } : field,
              ),
            }
          : pivot,
      ),
    );
  }

  return {
    addChartSeries,
    updateChart,
    updateChartSeries,
    updateChartSeriesName,
    updateChartSeriesPoint,
    updatePivotDataField,
    updatePivotField,
    updatePivotName,
    updateTable,
    updateTableColumn,
  };
}
