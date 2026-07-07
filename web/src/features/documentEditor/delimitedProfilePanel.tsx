import { columnName } from "./models";

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
