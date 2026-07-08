import { Eraser, Link, MessageSquare, Unlink } from "lucide-react";
import { useState } from "react";
import type { XlsxComment, XlsxHyperlink } from "../shared/models";
import { optionalTrimmedString } from "./spreadsheetPresentation";

export function SpreadsheetHyperlinkControls({
  hyperlink,
  disabled,
  onChange,
}: {
  hyperlink?: XlsxHyperlink;
  disabled: boolean;
  onChange: (hyperlink: XlsxHyperlink | null) => void;
}) {
  const persistedMode = hyperlink?.location
    ? "location"
    : hyperlink?.target
      ? "target"
      : "";
  const [draftMode, setDraftMode] = useState<"" | "target" | "location">("");
  const mode = persistedMode || draftMode;

  function patchHyperlink(
    patch: Partial<XlsxHyperlink>,
    nextMode: "target" | "location" = mode === "location" ? "location" : "target",
  ) {
    const display = optionalTrimmedString(
      patch.display ?? hyperlink?.display,
    );
    const tooltip = optionalTrimmedString(
      patch.tooltip ?? hyperlink?.tooltip,
    );
    if (nextMode === "location") {
      const location = optionalTrimmedString(
        patch.location ?? hyperlink?.location,
      );
      if (!location) {
        onChange(null);
        return;
      }
      onChange({
        ref: hyperlink?.ref ?? "",
        location,
        display,
        tooltip,
      });
      return;
    }
    const target = optionalTrimmedString(
      patch.target ?? hyperlink?.target,
    );
    if (!target) {
      onChange(null);
      return;
    }
    onChange({
      ref: hyperlink?.ref ?? "",
      target,
      display,
      tooltip,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <Link className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          const nextMode = event.currentTarget.value as "" | "target" | "location";
          setDraftMode(nextMode);
          if (!nextMode) {
            onChange(null);
          }
        }}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Hyperlink"
      >
        <option value="">No link</option>
        <option value="target">URL</option>
        <option value="location">Sheet</option>
      </select>
      {mode === "target" && (
        <input
          value={hyperlink?.target ?? ""}
          disabled={disabled}
          onChange={(event) => patchHyperlink({ target: event.target.value }, "target")}
          className="h-7 w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="URL"
          title="Hyperlink target URL"
        />
      )}
      {mode === "location" && (
        <input
          value={hyperlink?.location ?? ""}
          disabled={disabled}
          onChange={(event) =>
            patchHyperlink({ location: event.target.value }, "location")
          }
          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="Sheet reference"
          title="Hyperlink sheet location"
        />
      )}
      {mode && (
        <>
          <input
            value={hyperlink?.display ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ display: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Display"
            title="Hyperlink display text"
          />
          <input
            value={hyperlink?.tooltip ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ tooltip: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Tooltip"
            title="Hyperlink tooltip"
          />
          <button
            type="button"
            onClick={() => {
              setDraftMode("");
              onChange(null);
            }}
            disabled={disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Remove hyperlink"
          >
            <Unlink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );
}

export function SpreadsheetCommentControls({
  comment,
  disabled,
  onChange,
}: {
  comment?: XlsxComment;
  disabled: boolean;
  onChange: (comment: XlsxComment | null) => void;
}) {
  function patchComment(patch: Partial<XlsxComment>) {
    const text = patch.text ?? comment?.text ?? "";
    if (!text.trim()) {
      onChange(null);
      return;
    }
    onChange({
      ref: comment?.ref ?? "",
      author: optionalTrimmedString(patch.author ?? comment?.author),
      text,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <MessageSquare className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <input
        value={comment?.author ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ author: event.target.value })}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Author"
        title="Comment author"
      />
      <textarea
        value={comment?.text ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ text: event.target.value })}
        className="h-7 w-48 resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Comment"
        title="Cell comment"
      />
      {comment && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Remove comment"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
