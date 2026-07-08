import { Eye, EyeOff, LocateFixed, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { XlsxDefinedName, XlsxSheet } from "../shared/models";
import { xlsxDefinedNameTarget } from "./spreadsheetDefinedNames";

export function SpreadsheetDefinedNamesPanel({
  definedNames,
  sheets,
  activeSelectionValue,
  onAddFromSelection,
  onChange,
  onDelete,
  onSelect,
}: {
  definedNames: XlsxDefinedName[];
  sheets: XlsxSheet[];
  activeSelectionValue?: string;
  onAddFromSelection: () => void;
  onChange: (index: number, next: XlsxDefinedName) => void;
  onDelete: (index: number) => void;
  onSelect: (definedName: XlsxDefinedName) => void;
}) {
  const duplicateKeys = duplicateDefinedNameKeys(definedNames);
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <LocateFixed
          className="h-3.5 w-3.5 text-[var(--text-muted)]"
          strokeWidth={1.75}
        />
        <span className="font-medium text-[var(--text)]">Named ranges</span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {definedNames.length} names
        </span>
        <button
          type="button"
          onClick={onAddFromSelection}
          disabled={!activeSelectionValue}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Add named range from the current selection"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add
        </button>
      </div>
      {definedNames.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-faint)]">
          Select cells and add a named range.
        </div>
      ) : (
        <div className="grid max-h-72 gap-2 overflow-auto pr-1">
          {definedNames.map((definedName, index) => {
            const target = xlsxDefinedNameTarget(definedName.value);
            const validName = isValidDefinedName(definedName.name);
            const duplicate =
              duplicateKeys.get(definedNameKey(definedName)) === true;
            return (
              <div
                key={`${definedName.name}:${definedName.localSheetId ?? "workbook"}:${index}`}
                className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 lg:grid-cols-[minmax(8rem,0.85fr)_minmax(12rem,1.2fr)_minmax(8rem,0.65fr)_auto]"
              >
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                    Name
                  </span>
                  <input
                    value={definedName.name}
                    onChange={(event) =>
                      onChange(index, {
                        ...definedName,
                        name: event.currentTarget.value,
                        sourceXml: undefined,
                      })
                    }
                    className={cn(
                      "h-8 rounded-md border bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]",
                      validName && !duplicate
                        ? "border-[var(--border)]"
                        : "border-[var(--status-error)]",
                    )}
                  />
                  {(!validName || duplicate) && (
                    <span className="text-[10px] text-[var(--status-error)]">
                      {duplicate ? "Duplicate scope name" : "Invalid Excel name"}
                    </span>
                  )}
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                    Refers to
                  </span>
                  <input
                    value={definedName.value}
                    onChange={(event) =>
                      onChange(index, {
                        ...definedName,
                        value: event.currentTarget.value,
                        sourceXml: undefined,
                      })
                    }
                    className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                    Scope
                  </span>
                  <select
                    value={
                      definedName.localSheetId === undefined
                        ? "workbook"
                        : String(definedName.localSheetId)
                    }
                    onChange={(event) =>
                      onChange(index, {
                        ...definedName,
                        localSheetId:
                          event.currentTarget.value === "workbook"
                            ? undefined
                            : Number(event.currentTarget.value),
                        sourceXml: undefined,
                      })
                    }
                    className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="workbook">Workbook</option>
                    {sheets.map((sheet, sheetIndex) => (
                      <option key={sheet.id} value={sheetIndex}>
                        {sheet.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(index, {
                        ...definedName,
                        hidden: !definedName.hidden,
                        sourceXml: undefined,
                      })
                    }
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                      definedName.hidden && "text-[var(--accent)]",
                    )}
                    title={definedName.hidden ? "Show name" : "Hide name"}
                  >
                    {definedName.hidden ? (
                      <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                    ) : (
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(definedName)}
                    disabled={!target}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="Go to reference"
                  >
                    <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(index)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
                    title="Delete named range"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
                <label className="grid gap-1 lg:col-span-4">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                    Comment
                  </span>
                  <input
                    value={definedName.comment ?? ""}
                    onChange={(event) =>
                      onChange(index, {
                        ...definedName,
                        comment: event.currentTarget.value || undefined,
                        sourceXml: undefined,
                      })
                    }
                    className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function duplicateDefinedNameKeys(definedNames: XlsxDefinedName[]) {
  const counts = new Map<string, number>();
  for (const definedName of definedNames) {
    const key = definedNameKey(definedName);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map([...counts].map(([key, count]) => [key, count > 1]));
}

function definedNameKey(definedName: XlsxDefinedName) {
  return `${definedName.localSheetId ?? "workbook"}:${definedName.name.trim().toLowerCase()}`;
}

function isValidDefinedName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (/^\$?[A-Z]{1,3}\$?\d+$/i.test(trimmed)) return false;
  return /^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(trimmed);
}
