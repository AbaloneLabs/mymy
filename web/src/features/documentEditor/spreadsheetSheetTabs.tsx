import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeColorInputValue } from "./spreadsheetPresentation";
import type { XlsxSheet } from "./models";

export function SpreadsheetSheetTabs({
  sheets,
  activeSheet,
  onSelectSheet,
  onAddSheet,
  onDuplicateSheet,
  onDeleteSheet,
  onMoveSheet,
  onRenameSheet,
  onSheetStateChange,
  onSheetTabColorChange,
}: {
  sheets: XlsxSheet[];
  activeSheet: XlsxSheet | undefined;
  onSelectSheet: (sheetId: string) => void;
  onAddSheet: () => void;
  onDuplicateSheet: () => void;
  onDeleteSheet: () => void;
  onMoveSheet: (direction: -1 | 1) => void;
  onRenameSheet: (name: string) => void;
  onSheetStateChange: (state: XlsxSheet["state"]) => void;
  onSheetTabColorChange: (color: string) => void;
}) {
  const activeSheetIndex = activeSheet
    ? sheets.findIndex((item) => item.id === activeSheet.id)
    : -1;

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
      {sheets.map((item) => {
        const hidden = item.state === "hidden" || item.state === "veryHidden";
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectSheet(item.id)}
            className={cn(
              "rounded-md border-t-2 px-2 py-1 text-xs",
              item.id === activeSheet?.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              hidden && "opacity-60",
            )}
            style={{
              borderTopColor: item.tabColor ?? "transparent",
            }}
            title={hidden ? `Sheet is ${item.state}` : undefined}
          >
            {item.name}
            {hidden && <span className="ml-1 text-[10px] uppercase">{item.state}</span>}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAddSheet}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        title="Add sheet"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDuplicateSheet}
        disabled={!activeSheet}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Duplicate sheet"
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteSheet}
        disabled={!activeSheet || sheets.length <= 1}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete sheet"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveSheet(-1)}
        disabled={!activeSheet || activeSheetIndex <= 0}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Move sheet left"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveSheet(1)}
        disabled={!activeSheet || activeSheetIndex >= sheets.length - 1}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Move sheet right"
      >
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {activeSheet && (
        <>
          <input
            value={activeSheet.name}
            onChange={(event) => onRenameSheet(event.target.value)}
            maxLength={31}
            className="ml-auto h-7 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            aria-label="Sheet name"
          />
          <select
            value={activeSheet.state ?? "visible"}
            onChange={(event) =>
              onSheetStateChange(event.currentTarget.value as XlsxSheet["state"])
            }
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            aria-label="Sheet visibility"
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="veryHidden">Very hidden</option>
          </select>
          <input
            type="color"
            value={normalizeColorInputValue(activeSheet.tabColor)}
            onChange={(event) => onSheetTabColorChange(event.currentTarget.value)}
            className="h-7 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg)] p-1"
            aria-label="Sheet tab color"
          />
        </>
      )}
    </div>
  );
}
