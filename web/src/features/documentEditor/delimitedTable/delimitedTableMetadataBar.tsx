import type { DelimitedTableModel } from "../shared/models";
import { delimitedLineEndingValue } from "./delimitedTableUtils";

export function DelimitedTableMetadataBar({
  model,
  onChange,
}: {
  model: DelimitedTableModel;
  onChange: (model: DelimitedTableModel) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
      <span className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text-faint)]">
        {model.encoding ?? "utf-8"}
      </span>
      <label className="inline-flex items-center gap-1.5">
        Line ending
        <select
          value={delimitedLineEndingValue(model.lineEnding)}
          onChange={(event) => onChange({ ...model, lineEnding: event.target.value })}
          className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value={"\n"}>LF</option>
          <option value={"\r\n"}>CRLF</option>
          <option value={"\r"}>CR</option>
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5">
        Quote
        <select
          value={model.quoteStyle ?? "minimal"}
          onChange={(event) =>
            onChange({
              ...model,
              quoteStyle: event.target.value === "always" ? "always" : "minimal",
            })
          }
          className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="minimal">minimal</option>
          <option value="always">always</option>
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
        <input
          type="checkbox"
          checked={model.bom === true}
          onChange={(event) => onChange({ ...model, bom: event.target.checked })}
        />
        BOM
      </label>
      <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
        <input
          type="checkbox"
          checked={model.trailingNewline === true}
          onChange={(event) =>
            onChange({ ...model, trailingNewline: event.target.checked })
          }
        />
        Final newline
      </label>
    </div>
  );
}
