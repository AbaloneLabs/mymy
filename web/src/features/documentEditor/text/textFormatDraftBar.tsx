import type { TextFileFormatDraft } from "./textFormatDraft";

export function TextFormatDraftBar({
  baseline,
  draft,
  changedKeys,
  issue,
  conflict,
  impact,
  onChange,
  onApply,
  onCancel,
}: {
  baseline: TextFileFormatDraft;
  draft: TextFileFormatDraft;
  changedKeys: Array<keyof TextFileFormatDraft>;
  issue: string | null;
  conflict: boolean;
  impact: { estimatedBytes: number; lineBreaks: number; sample: string };
  onChange: (draft: TextFileFormatDraft) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Encoding
          </span>
          <select
            value={draft.encoding}
            onChange={(event) => {
              const encoding = event.currentTarget
                .value as TextFileFormatDraft["encoding"];
              onChange({
                ...draft,
                encoding,
                bom:
                  encoding === "utf-16le" || encoding === "utf-16be"
                    ? true
                    : encoding === "windows-1252"
                      ? false
                      : draft.bom,
              });
            }}
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="utf-8">UTF-8</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
            <option value="windows-1252">Windows-1252</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Line ending
          </span>
          <select
            value={draft.lineEnding}
            onChange={(event) =>
              onChange({
                ...draft,
                lineEnding: event.currentTarget
                  .value as TextFileFormatDraft["lineEnding"],
              })
            }
            className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value={"\n"}>LF</option>
            <option value={"\r\n"}>CRLF</option>
            <option value={"\r"}>CR</option>
          </select>
        </label>
        <label className="inline-flex h-8 items-center gap-2 rounded border border-[var(--border)] px-2">
          <input
            type="checkbox"
            checked={draft.bom}
            disabled={draft.encoding === "windows-1252"}
            onChange={(event) =>
              onChange({ ...draft, bom: event.currentTarget.checked })
            }
          />
          BOM
        </label>
        <span className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[10px]">
          Baseline: {baseline.encoding} · {lineEndingName(baseline.lineEnding)} ·{" "}
          {baseline.bom ? "BOM" : "no BOM"}
        </span>
        <span className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[10px]">
          {impact.lineBreaks.toLocaleString()} line breaks · about{" "}
          {impact.estimatedBytes.toLocaleString()} bytes
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-[var(--border)] px-2 py-1.5 hover:bg-[var(--surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={changedKeys.length === 0 || Boolean(issue) || conflict}
            onClick={onApply}
            className="rounded border border-[var(--accent)] px-2 py-1.5 text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply file format
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2 text-[10px]">
        <span>
          Draft only · document remains unchanged until Apply
          {changedKeys.length > 0 ? ` · changes: ${changedKeys.join(", ")}` : ""}
        </span>
        <code className="max-w-full overflow-hidden text-ellipsis whitespace-pre rounded bg-[var(--bg)] px-2 py-1 text-[var(--text-faint)]">
          {impact.sample || "Empty file"}
        </code>
        {(issue || conflict) && (
          <span className="text-[var(--status-danger)]">
            {issue ??
              "File format changed outside this draft. Cancel and reopen the format editor."}
          </span>
        )}
      </div>
    </div>
  );
}

function lineEndingName(value: TextFileFormatDraft["lineEnding"]) {
  if (value === "\r\n") return "CRLF";
  if (value === "\r") return "CR";
  return "LF";
}
