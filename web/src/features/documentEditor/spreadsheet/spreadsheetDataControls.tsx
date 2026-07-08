import {
  ArrowDown,
  ArrowDownAZ,
  ArrowRight,
  ArrowUpAZ,
  Columns3,
  Copy,
  Eraser,
  Filter,
  FilterX,
  Table,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function SpreadsheetDataControls({
  onAddRow,
  onAddColumn,
  onCopySelection,
  onFillDown,
  onFillRight,
  onSortAsc,
  onSortDesc,
  onClearCell,
  onDeleteRow,
  onDeleteColumn,
  filterText,
  onFilterTextChange,
  autoFilter,
  onSetAutoFilter,
  onClearAutoFilter,
  canCopy,
  canFillDown,
  canFillRight,
  canSort,
  canSetAutoFilter = false,
  canClearCell,
  canDeleteRow,
  canDeleteColumn,
}: {
  onAddRow: () => void;
  onAddColumn: () => void;
  onCopySelection: () => void;
  onFillDown: () => void;
  onFillRight: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onClearCell: () => void;
  onDeleteRow: () => void;
  onDeleteColumn: () => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  autoFilter?: string;
  onSetAutoFilter?: () => void;
  onClearAutoFilter?: () => void;
  canCopy: boolean;
  canFillDown: boolean;
  canFillRight: boolean;
  canSort: boolean;
  canSetAutoFilter?: boolean;
  canClearCell: boolean;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        onClick={onAddRow}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addRow")}
      </button>
      <button
        type="button"
        onClick={onAddColumn}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addColumn")}
      </button>
      <button
        type="button"
        onClick={onCopySelection}
        disabled={!canCopy}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.copyRange", { defaultValue: "Copy range" })}
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillDown}
        disabled={!canFillDown}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillDown", { defaultValue: "Fill down" })}
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillRight}
        disabled={!canFillRight}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillRight", { defaultValue: "Fill right" })}
      >
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortAsc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort ascending"
      >
        <ArrowUpAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortDesc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort descending"
      >
        <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {onSetAutoFilter && (
        <button
          type="button"
          onClick={onSetAutoFilter}
          disabled={!canSetAutoFilter}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40",
            autoFilter && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={
            autoFilter
              ? `Saved XLSX filter range: ${autoFilter}`
              : "Set XLSX filter range"
          }
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
          {autoFilter ?? "Set filter"}
        </button>
      )}
      {onClearAutoFilter && autoFilter && (
        <button
          type="button"
          onClick={onClearAutoFilter}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Clear XLSX filter range"
        >
          <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      <div className="flex h-8 min-w-44 items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2">
        <Filter
          className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]"
          strokeWidth={1.75}
        />
        <input
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          placeholder="Filter rows"
        />
        {filterText && (
          <button
            type="button"
            onClick={() => onFilterTextChange("")}
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title="Clear filter"
          >
            <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClearCell}
        disabled={!canClearCell}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Clear cell"
      >
        <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteRow}
        disabled={!canDeleteRow}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete row"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteColumn}
        disabled={!canDeleteColumn}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete column"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </>
  );
}
