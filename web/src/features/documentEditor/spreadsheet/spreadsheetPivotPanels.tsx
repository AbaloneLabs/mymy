import type {
  XlsxPivot,
  XlsxPivotDataField,
  XlsxPivotField,
} from "../shared/models";

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

export function SpreadsheetPivotEditor({
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
