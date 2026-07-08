import type {
  XlsxTable,
  XlsxTableColumn,
} from "../shared/models";

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

export function SpreadsheetTableEditor({
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
