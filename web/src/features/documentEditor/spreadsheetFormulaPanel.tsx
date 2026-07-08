import { Sigma } from "lucide-react";
import type { XlsxDefinedName, XlsxSheet } from "./models";
import { columnName } from "./models";
import { xlsxDefinedNameTarget } from "./spreadsheetDefinedNames";
import { spreadsheetFormulaReferences } from "./spreadsheetFormula";

interface SpreadsheetFormulaRecord {
  ref: string;
  formula: string;
  dependencies: string[];
  cachedValue: string;
  recalculatedValue?: string;
}

interface SpreadsheetFormulaGraph {
  records: SpreadsheetFormulaRecord[];
  calculationOrder: string[];
  circularReferences: string[];
}

export function SpreadsheetFormulaDependencyPanel({
  sheet,
  recalculatedSheet,
  sheets,
  definedNames,
  activeReference,
  onSelectReference,
}: {
  sheet: XlsxSheet | undefined;
  recalculatedSheet?: XlsxSheet;
  sheets?: XlsxSheet[];
  definedNames?: XlsxDefinedName[];
  activeReference?: string;
  onSelectReference: (reference: string) => void;
}) {
  const graph = spreadsheetFormulaGraph(sheet, recalculatedSheet, sheets, definedNames);
  const { records } = graph;
  if (records.length === 0) return null;
  const activeRecord = records.find((record) => record.ref === activeReference);
  const activeDependents = activeReference
    ? records.filter((record) => record.dependencies.includes(activeReference))
    : [];
  const staleRecords = records.filter((record) => formulaCacheState(record) === "stale");
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
        {staleRecords.length > 0 && (
          <span className="rounded bg-[var(--status-warning)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-warning)]">
            {staleRecords.length} stale cached
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
                <span className="ml-2 text-[var(--text-faint)]">
                  {record.cachedValue || '""'}
                </span>
              </span>
              {graph.circularReferences.includes(record.ref) ? (
                <span className="rounded bg-[var(--status-error)]/10 px-1.5 py-0.5 text-[10px] text-[var(--status-error)]">
                  cycle
                </span>
              ) : formulaCacheState(record) === "stale" ? (
                <span className="rounded bg-[var(--status-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--status-warning)]">
                  stale
                </span>
              ) : (
                <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
                  cached
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
      <FormulaCachedResultPanel record={activeRecord ?? visibleRecords[0]} />
    </div>
  );
}

function FormulaCachedResultPanel({
  record,
}: {
  record: SpreadsheetFormulaRecord | undefined;
}) {
  if (!record) return null;
  const state = formulaCacheState(record);
  return (
    <div className="mt-2 grid gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-1 uppercase tracking-wide text-[var(--text-faint)]">
          Cached value
        </div>
        <code className="block truncate font-mono text-[var(--text)]">
          {record.cachedValue || '""'}
        </code>
      </div>
      <div>
        <div className="mb-1 uppercase tracking-wide text-[var(--text-faint)]">
          Recalculated value
        </div>
        <code className="block truncate font-mono text-[var(--text)]">
          {record.recalculatedValue ?? "Unavailable"}
        </code>
      </div>
      <div>
        <div className="mb-1 uppercase tracking-wide text-[var(--text-faint)]">
          Save policy
        </div>
        <div
          className={
            state === "stale"
              ? "text-[var(--status-warning)]"
              : "text-[var(--text-muted)]"
          }
        >
          {state === "stale"
            ? "Workbook edits recalculate and replace the stale cached value."
            : "Cached result matches the current recalculation."}
        </div>
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

function spreadsheetFormulaGraph(
  sheet: XlsxSheet | undefined,
  recalculatedSheet?: XlsxSheet,
  sheets: XlsxSheet[] = sheet ? [sheet] : [],
  definedNames: XlsxDefinedName[] = [],
): SpreadsheetFormulaGraph {
  const records = spreadsheetFormulaRecords(
    sheet,
    recalculatedSheet,
    (name) => referencesForDefinedName(name, sheet, sheets, definedNames),
  );
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
    calculationOrder,
    circularReferences: [...circularReferences].sort(compareSpreadsheetRefs),
  };
}

function spreadsheetFormulaRecords(
  sheet: XlsxSheet | undefined,
  recalculatedSheet?: XlsxSheet,
  referencesForName?: (name: string) => string[],
) {
  const records: SpreadsheetFormulaRecord[] = [];
  sheet?.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      if (!cell.formula) return;
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      records.push({
        ref,
        formula: cell.formula,
        dependencies: spreadsheetFormulaReferences(cell.formula, {
          referencesForName,
        }),
        cachedValue: cell.value,
        recalculatedValue: xlsxCellValueAt(recalculatedSheet, ref),
      });
    });
  });
  return records.sort((left, right) => compareSpreadsheetRefs(left.ref, right.ref));
}

function formulaCacheState(record: SpreadsheetFormulaRecord) {
  return record.recalculatedValue !== undefined &&
    record.cachedValue !== record.recalculatedValue
    ? "stale"
    : "matching";
}

function xlsxCellValueAt(sheet: XlsxSheet | undefined, ref: string) {
  if (!sheet) return undefined;
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) return undefined;
  const rowIndex = Number(match[2]) - 1;
  const columnIndex = columnNameIndex(match[1]);
  return sheet.rows[rowIndex]?.cells[columnIndex]?.value;
}

function referencesForDefinedName(
  name: string,
  sheet: XlsxSheet | undefined,
  sheets: XlsxSheet[],
  definedNames: XlsxDefinedName[],
) {
  if (!sheet) return [];
  const sheetIndex = sheets.findIndex((item) => item.id === sheet.id);
  const normalizedName = name.trim().toLowerCase();
  const definedName =
    definedNames.find(
      (item) =>
        item.name.trim().toLowerCase() === normalizedName &&
        item.localSheetId === sheetIndex,
    ) ??
    definedNames.find(
      (item) =>
        item.name.trim().toLowerCase() === normalizedName &&
        item.localSheetId === undefined,
    );
  if (!definedName) return [];
  const target = xlsxDefinedNameTarget(definedName.value);
  if (!target) return [];
  const targetSheet =
    target.sheetName ??
    (definedName.localSheetId !== undefined
      ? sheets[definedName.localSheetId]?.name
      : sheet.name);
  const prefix = targetSheet ? `${quoteFormulaSheetName(targetSheet)}!` : "";
  const references: string[] = [];
  for (let row = target.range.top; row <= target.range.bottom; row += 1) {
    for (let column = target.range.left; column <= target.range.right; column += 1) {
      references.push(`${prefix}${columnName(column)}${row + 1}`);
    }
  }
  return references;
}

function quoteFormulaSheetName(sheetName: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)) return sheetName;
  return `'${sheetName.replace(/'/g, "''")}'`;
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
