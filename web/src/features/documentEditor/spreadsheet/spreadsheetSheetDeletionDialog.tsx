import type { XlsxSheetDeletionPreview } from "./spreadsheetSheetActions";

export function SpreadsheetSheetDeletionDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: XlsxSheetDeletionPreview;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xlsx-delete-sheet-title"
        className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 shadow-xl"
      >
        <h2 id="xlsx-delete-sheet-title" className="text-sm font-semibold text-[var(--text)]">
          Delete sheet “{preview.sheetName}”?
        </h2>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          This removes {preview.populatedCells} populated cell
          {preview.populatedCells === 1 ? "" : "s"} and {preview.ownedObjects} owned
          object{preview.ownedObjects === 1 ? "" : "s"}. Cancel leaves the workbook
          unchanged.
        </p>
        {preview.impacts.length > 0 ? (
          <div className="mt-3 rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 p-3">
            <p className="text-xs font-medium text-[var(--status-warning)]">
              {preview.impacts.length} external reference
              {preview.impacts.length === 1 ? "" : "s"} will become #REF!.
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto font-mono text-[10px] text-[var(--text-muted)]">
              {preview.impacts.slice(0, 12).map((impact, index) => (
                <li key={`${impact.kind}-${impact.owner}-${index}`}>
                  {impact.owner}: {impact.formula}
                </li>
              ))}
              {preview.impacts.length > 12 && (
                <li>…and {preview.impacts.length - 12} more</li>
              )}
            </ul>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
            No formula, validation, conditional-formatting, hyperlink, chart, or
            defined-name reference outside this sheet was found.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="h-8 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-8 rounded-md bg-[var(--status-error)] px-3 text-xs text-white hover:opacity-90"
          >
            {preview.impacts.length > 0 ? "Delete and create #REF!" : "Delete sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}
