import type { ComponentType } from "react";
import { BarChart3, ImageIcon, Sigma, Table } from "lucide-react";
import type { XlsxChart, XlsxImage, XlsxPivot, XlsxSheet } from "./models";
import { columnName } from "./models";
import { spreadsheetFormulaReferences } from "./spreadsheetFormula";
import {
  formatNumber,
  xlsxAnchorLabel,
  xlsxChartLabel,
  xlsxPivotLabel,
  xlsxTableDetail,
  xlsxTableLabel,
} from "./spreadsheetPresentation";

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

export function DelimitedTableProfilePanel({
  rows,
  headerRow,
  onHeaderRowChange,
}: {
  rows: string[][];
  headerRow: boolean;
  onHeaderRowChange: (value: boolean) => void;
}) {
  const profile = delimitedTableProfile(rows, headerRow);
  if (profile.columns.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[var(--text)]">Data profile</span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {profile.rowCount} rows · {profile.columnCount} columns · {profile.populatedCells} filled
        </span>
        <label className="ml-auto inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(event) => onHeaderRowChange(event.currentTarget.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Header row
        </label>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {profile.columns.slice(0, 32).map((column) => (
          <div
            key={column.index}
            className="min-w-44 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text)]">
                  {column.label}
                </div>
                <div className="font-mono text-[10px] text-[var(--text-faint)]">
                  {columnName(column.index)}
                </div>
              </div>
              <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                {column.type}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-[var(--text-muted)]">
              <Metric label="Filled" value={column.populated} />
              <Metric label="Blank" value={column.blank} />
              <Metric label="Unique" value={column.unique} />
            </div>
            {column.samples.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {column.samples.map((sample) => (
                  <span
                    key={sample}
                    className="max-w-36 truncate rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                    title={sample}
                  >
                    {sample}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-[var(--surface)] px-1.5 py-1">
      <div className="font-mono text-[11px] text-[var(--text)]">{value}</div>
      <div>{label}</div>
    </div>
  );
}

interface SpreadsheetFormulaRecord {
  ref: string;
  formula: string;
  dependencies: string[];
}

interface SpreadsheetFormulaGraph {
  records: SpreadsheetFormulaRecord[];
  recordByRef: Map<string, SpreadsheetFormulaRecord>;
  calculationOrder: string[];
  circularReferences: string[];
}

export function SpreadsheetFormulaDependencyPanel({
  sheet,
  activeReference,
  onSelectReference,
}: {
  sheet: XlsxSheet | undefined;
  activeReference?: string;
  onSelectReference: (reference: string) => void;
}) {
  const graph = spreadsheetFormulaGraph(sheet);
  const { records } = graph;
  if (records.length === 0) return null;
  const activeRecord = records.find((record) => record.ref === activeReference);
  const activeDependents = activeReference
    ? records.filter((record) => record.dependencies.includes(activeReference))
    : [];
  const visibleRecords = activeRecord
    ? [activeRecord, ...records.filter((record) => record.ref !== activeRecord.ref)]
    : records;

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Sigma className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
        <span className="font-medium text-[var(--text)]">Formula graph</span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {records.length} formulas
        </span>
        {graph.circularReferences.length > 0 && (
          <span className="rounded bg-[var(--status-error)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-error)]">
            {graph.circularReferences.length} circular
          </span>
        )}
      </div>
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)]">
        <div className="max-h-36 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg)]">
          {visibleRecords.slice(0, 80).map((record) => (
            <button
              key={record.ref}
              type="button"
              onClick={() => onSelectReference(record.ref)}
              className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 border-b border-[var(--border)] px-2 py-1.5 text-left last:border-b-0 hover:bg-[var(--surface-hover)]"
            >
              <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                {record.ref}
              </span>
              <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text)]">
                ={record.formula}
              </span>
              {graph.circularReferences.includes(record.ref) && (
                <span className="rounded bg-[var(--status-error)]/10 px-1.5 py-0.5 text-[10px] text-[var(--status-error)]">
                  cycle
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <FormulaReferenceList
            title="References"
            references={activeRecord?.dependencies ?? []}
            onSelectReference={onSelectReference}
          />
          <FormulaReferenceList
            title="Dependents"
            references={activeDependents.map((record) => record.ref)}
            onSelectReference={onSelectReference}
          />
          {graph.circularReferences.length > 0 && (
            <FormulaReferenceList
              title="Circular"
              references={graph.circularReferences}
              onSelectReference={onSelectReference}
            />
          )}
        </div>
        <FormulaCalculationOrderList
          references={graph.calculationOrder}
          circularReferences={graph.circularReferences}
          onSelectReference={onSelectReference}
        />
      </div>
    </div>
  );
}

function FormulaCalculationOrderList({
  references,
  circularReferences,
  onSelectReference,
}: {
  references: string[];
  circularReferences: string[];
  onSelectReference: (reference: string) => void;
}) {
  const visibleReferences = [
    ...references,
    ...circularReferences.filter((reference) => !references.includes(reference)),
  ];
  return (
    <div className="max-h-36 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        Calculation order
      </div>
      {visibleReferences.length === 0 ? (
        <div className="text-[11px] text-[var(--text-faint)]">None</div>
      ) : (
        <div className="grid gap-1">
          {visibleReferences.slice(0, 80).map((reference, index) => (
            <button
              key={`${reference}:${index}`}
              type="button"
              onClick={() => onSelectReference(reference)}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 rounded px-1.5 py-1 text-left hover:bg-[var(--surface-hover)]"
            >
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {index + 1}
              </span>
              <span className="font-mono text-[11px] text-[var(--text)]">
                {reference}
              </span>
              {circularReferences.includes(reference) && (
                <span className="text-[10px] text-[var(--status-error)]">
                  circular
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormulaReferenceList({
  title,
  references,
  onSelectReference,
}: {
  title: string;
  references: string[];
  onSelectReference: (reference: string) => void;
}) {
  return (
    <div className="min-h-16 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        {title}
      </div>
      {references.length === 0 ? (
        <div className="text-[11px] text-[var(--text-faint)]">None</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {references.map((reference) => (
            <button
              key={reference}
              type="button"
              onClick={() => onSelectReference(reference)}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {reference}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function spreadsheetFormulaGraph(sheet: XlsxSheet | undefined): SpreadsheetFormulaGraph {
  const records = spreadsheetFormulaRecords(sheet);
  const recordByRef = new Map(records.map((record) => [record.ref, record]));
  const visitState = new Map<string, "visiting" | "visited">();
  const calculationOrder: string[] = [];
  const circularReferences = new Set<string>();

  function visit(reference: string, path: string[]) {
    const state = visitState.get(reference);
    if (state === "visited") return;
    if (state === "visiting") {
      const cycleStart = path.indexOf(reference);
      const cycle = cycleStart >= 0 ? path.slice(cycleStart) : [reference];
      cycle.forEach((item) => circularReferences.add(item));
      return;
    }
    const record = recordByRef.get(reference);
    if (!record) return;
    visitState.set(reference, "visiting");
    record.dependencies
      .filter((dependency) => recordByRef.has(dependency))
      .forEach((dependency) => visit(dependency, [...path, reference]));
    visitState.set(reference, "visited");
    if (!circularReferences.has(reference)) calculationOrder.push(reference);
  }

  records.forEach((record) => visit(record.ref, []));

  return {
    records,
    recordByRef,
    calculationOrder,
    circularReferences: [...circularReferences].sort(compareSpreadsheetRefs),
  };
}

function spreadsheetFormulaRecords(sheet: XlsxSheet | undefined) {
  const records: SpreadsheetFormulaRecord[] = [];
  sheet?.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      if (!cell.formula) return;
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      records.push({
        ref,
        formula: cell.formula,
        dependencies: spreadsheetFormulaReferences(cell.formula),
      });
    });
  });
  return records.sort((left, right) => compareSpreadsheetRefs(left.ref, right.ref));
}

function compareSpreadsheetRefs(left: string, right: string) {
  const leftMatch = /^([A-Z]+)(\d+)$/i.exec(left);
  const rightMatch = /^([A-Z]+)(\d+)$/i.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  const rowDiff = Number(leftMatch[2]) - Number(rightMatch[2]);
  if (rowDiff !== 0) return rowDiff;
  return columnNameIndex(leftMatch[1]) - columnNameIndex(rightMatch[1]);
}

function columnNameIndex(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function delimitedTableProfile(rows: string[][], headerRow: boolean) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  const bodyRows = headerRow ? rows.slice(1) : rows;
  const populatedCells = rows.reduce(
    (total, row) => total + row.filter((cell) => cell.trim() !== "").length,
    0,
  );
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const label = headerRow && rows[0]?.[index]?.trim()
      ? rows[0][index].trim()
      : columnName(index);
    const values = bodyRows.map((row) => row[index] ?? "");
    const populatedValues = values
      .map((value) => value.trim())
      .filter((value) => value !== "");
    return {
      index,
      label,
      type: inferDelimitedColumnType(populatedValues),
      populated: populatedValues.length,
      blank: Math.max(0, values.length - populatedValues.length),
      unique: new Set(populatedValues).size,
      samples: [...new Set(populatedValues)].slice(0, 4),
    };
  });

  return {
    rowCount: rows.length,
    columnCount,
    populatedCells,
    columns,
  };
}

function inferDelimitedColumnType(values: string[]) {
  if (values.length === 0) return "empty";
  const counts = values.reduce<Record<string, number>>((current, value) => {
    const type = inferDelimitedCellType(value);
    current[type] = (current[type] ?? 0) + 1;
    return current;
  }, {});
  const ranked = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  if (ranked.length === 1) return ranked[0][0];
  const [majorType, majorCount] = ranked[0];
  return majorCount / values.length >= 0.85 ? majorType : "mixed";
}

function inferDelimitedCellType(value: string) {
  const normalized = value.trim();
  if (!normalized) return "empty";
  if (/^(true|false)$/i.test(normalized)) return "boolean";
  if (Number.isFinite(Number(normalized.replace(/,/g, "")))) return "number";
  if (isDelimitedDateLike(normalized)) return "date";
  return "text";
}

function isDelimitedDateLike(value: string) {
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value.replace(/\//g, "-"));
  return Number.isFinite(timestamp);
}

export function SpreadsheetObjectStrip({
  sheet,
  onChartTitleChange,
  onChartSeriesNameChange,
  onChartPointChange,
  onPivotNameChange,
}: {
  sheet: XlsxSheet | undefined;
  onChartTitleChange: (chartId: string, title: string) => void;
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
      {(charts.length > 0 || pivots.length > 0) && (
        <div className="max-h-64 overflow-auto border-t border-[var(--border)] px-3 py-2">
          <div className="grid gap-2">
            {charts.map((chart) => (
              <SpreadsheetChartEditor
                key={`chart-editor:${chart.id}:${chart.path ?? ""}`}
                chart={chart}
                onTitleChange={(title) => onChartTitleChange(chart.id, title)}
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpreadsheetPivotEditor({
  pivot,
  onNameChange,
}: {
  pivot: XlsxPivot;
  onNameChange: (name: string) => void;
}) {
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
    </div>
  );
}

function SpreadsheetChartEditor({
  chart,
  onTitleChange,
  onSeriesNameChange,
  onPointChange,
}: {
  chart: XlsxChart;
  onTitleChange: (title: string) => void;
  onSeriesNameChange: (seriesIndex: number, value: string) => void;
  onPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="mb-2 grid gap-2 md:grid-cols-[minmax(12rem,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Chart title
          </span>
          <input
            value={chart.title ?? ""}
            onChange={(event) => onTitleChange(event.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-end text-[11px] text-[var(--text-muted)]">
          {chart.type ?? "chart"}
        </div>
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
