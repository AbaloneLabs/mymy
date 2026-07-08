import { columnName } from "./models";
import type { DelimitedTableModel } from "./models";

const DELIMITED_COLUMN_TYPES = [
  "auto",
  "text",
  "number",
  "date",
  "boolean",
  "mixed",
  "empty",
] as const;

export function DelimitedTableProfilePanel({
  rows,
  headerRow,
  model,
  onModelChange,
}: {
  rows: string[][];
  headerRow: boolean;
  model: DelimitedTableModel;
  onModelChange: (model: DelimitedTableModel) => void;
}) {
  const profile = delimitedTableProfile(rows, headerRow);
  const delimiter = model.delimiter ?? ",";
  const quoteCharacter = model.quoteCharacter ?? "\"";
  const escapePolicy = model.escapePolicy ?? "double";
  const columnTypes = model.columnTypes ?? [];
  if (profile.columns.length === 0) return null;
  function patch(patch: Partial<DelimitedTableModel>) {
    onModelChange({ ...model, ...patch });
  }
  function updateColumnType(index: number, value: string) {
    const next = Array.from({ length: profile.columnCount }, (_, columnIndex) =>
      columnTypes[columnIndex] ?? "auto",
    );
    next[index] = value;
    patch({ columnTypes: next });
  }
  function applyInferredColumnTypes() {
    patch({ columnTypes: profile.columns.map((column) => column.inferredType) });
  }
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[var(--text)]">Data profile</span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {profile.rowCount} rows · {profile.columnCount} columns · {profile.populatedCells} filled
        </span>
        <button
          type="button"
          onClick={applyInferredColumnTypes}
          className="ml-auto h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          Use inferred types
        </button>
        <label className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(event) => patch({ headerRow: event.currentTarget.checked })}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Header row
        </label>
      </div>
      <div className="mb-2 grid gap-2 md:grid-cols-5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Delimiter
          </span>
          <select
            value={delimiterPreset(delimiter)}
            onChange={(event) => patch({ delimiter: delimiterFromPreset(event.target.value) })}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value=",">Comma</option>
            <option value="\t">Tab</option>
            <option value=";">Semicolon</option>
            <option value="|">Pipe</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Custom delimiter
          </span>
          <input
            value={delimiterPreset(delimiter) === "custom" ? delimiter : ""}
            onChange={(event) => {
              const [next] = [...event.target.value];
              if (next && next !== "\n" && next !== "\r") patch({ delimiter: next });
            }}
            placeholder="1 char"
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Quote
          </span>
          <select
            value={quoteCharacter}
            onChange={(event) => patch({ quoteCharacter: event.target.value })}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value={'"'}>double quote</option>
            <option value="'">single quote</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Escape
          </span>
          <select
            value={escapePolicy}
            onChange={(event) =>
              patch({
                escapePolicy:
                  event.target.value === "backslash" ? "backslash" : "double",
              })
            }
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="double">double quote</option>
            <option value="backslash">backslash</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Encoding
          </span>
          <select
            value={model.encoding ?? "utf-8"}
            onChange={(event) => patch({ encoding: event.target.value })}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="utf-8">UTF-8</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
            <option value="windows-1252">Windows-1252</option>
          </select>
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
              <select
                value={columnTypes[column.index] ?? "auto"}
                onChange={(event) => updateColumnType(column.index, event.target.value)}
                className="h-7 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] text-[var(--accent)] outline-none focus:border-[var(--accent)]"
                title={`Inferred: ${column.inferredType}`}
              >
                {DELIMITED_COLUMN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "auto" ? `auto: ${column.inferredType}` : type}
                  </option>
                ))}
              </select>
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
      inferredType: inferDelimitedColumnType(populatedValues),
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

function delimiterPreset(value: string) {
  if (value === "," || value === "\t" || value === ";" || value === "|") return value;
  return "custom";
}

function delimiterFromPreset(value: string) {
  if (value === "\\t") return "\t";
  if (value === "," || value === "\t" || value === ";" || value === "|") return value;
  return ",";
}
