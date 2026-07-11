import type { MarkdownReference } from "./markdownEditorUtils";
import {
  markdownReferenceInputLabel,
  singleLineMarkdownReferenceTarget,
} from "./markdownReferenceActions";
import { MarkdownReferenceField } from "./markdownReferenceField";

type MarkdownActiveReferenceBarProps = {
  reference: MarkdownReference;
  onFocusRange: (start: number, end: number) => void;
  onLabelChange: (reference: MarkdownReference, value: string) => void;
  onTargetChange: (reference: MarkdownReference, value: string) => void;
};

export function MarkdownActiveReferenceBar({
  reference,
  onFocusRange,
  onLabelChange,
  onTargetChange,
}: MarkdownActiveReferenceBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
      <span className="mb-2 rounded border border-[var(--border)] px-1.5 py-0.5 uppercase text-[10px] text-[var(--text-faint)]">
        {reference.kind}
      </span>
      {reference.labelEditable &&
        reference.labelStart !== undefined &&
        reference.labelEnd !== undefined && (
          <label className="grid min-w-40 gap-1">
            <span className="uppercase tracking-wide">
              {reference.kind === "image"
                ? "Alt"
                : reference.kind === "footnote"
                  ? "Footnote"
                  : "Label"}
            </span>
            <MarkdownReferenceField
              value={markdownReferenceInputLabel(reference)}
              onCommit={(value) => onLabelChange(reference, value)}
              className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        )}
      {reference.targetEditable &&
        reference.targetStart !== undefined &&
        reference.targetEnd !== undefined && (
          <label className="grid min-w-56 flex-1 gap-1">
            <span className="uppercase tracking-wide">
              {reference.kind === "footnote" ? "Body" : "Target"}
            </span>
            <MarkdownReferenceField
              value={singleLineMarkdownReferenceTarget(reference)}
              onCommit={(value) => onTargetChange(reference, value)}
              className="h-8 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        )}
      {reference.preservationReason && (
        <span className="mb-1 max-w-md rounded border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-2 py-1.5 text-[10px] text-[var(--status-warning)]">
          {reference.preservationReason}
        </span>
      )}
      <button
        type="button"
        onClick={() => onFocusRange(reference.start, reference.end)}
        className="mb-0.5 rounded border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        Focus
      </button>
    </div>
  );
}
