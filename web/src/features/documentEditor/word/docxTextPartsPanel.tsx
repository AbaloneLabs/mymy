import { Hash, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DocxBlock,
  DocxComment,
  DocxContentControl,
  DocxNote,
  DocxRevision,
  DocxTextPart,
} from "../shared/models";

const DOCX_PAGE_FIELD_TOKEN = "{PAGE}";

export function DocxTextPartsPanel({
  headers,
  footers,
  comments,
  footnotes,
  endnotes,
  blocks,
  onHeaderChange,
  onFooterChange,
  onCommentChange,
  onCommentDelete,
  onFootnoteChange,
  onFootnoteDelete,
  onEndnoteChange,
  onEndnoteDelete,
  onFieldInstructionChange,
  onContentControlChange,
  onRevisionActionChange,
}: {
  headers: DocxTextPart[];
  footers: DocxTextPart[];
  comments: DocxComment[];
  footnotes: DocxNote[];
  endnotes: DocxNote[];
  blocks: DocxBlock[];
  onHeaderChange: (index: number, text: string) => void;
  onFooterChange: (index: number, text: string) => void;
  onCommentChange: (index: number, patch: Partial<DocxComment>) => void;
  onCommentDelete: (index: number) => void;
  onFootnoteChange: (index: number, text: string) => void;
  onFootnoteDelete: (index: number) => void;
  onEndnoteChange: (index: number, text: string) => void;
  onEndnoteDelete: (index: number) => void;
  onFieldInstructionChange: (
    blockIndex: number,
    fieldIndex: number,
    instruction: string,
  ) => void;
  onContentControlChange: (
    blockIndex: number,
    controlIndex: number,
    patch: Partial<DocxContentControl>,
  ) => void;
  onRevisionActionChange: (
    blockIndex: number,
    revisionIndex: number,
    action: DocxRevision["action"],
  ) => void;
}) {
  return (
    <div className="grid shrink-0 gap-3 border-b border-[var(--border)] bg-[var(--surface)] p-3 lg:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <DocxTextPartGroup
        title="Headers"
        emptyLabel="No existing headers"
        parts={headers}
        onChange={onHeaderChange}
      />
      <DocxTextPartGroup
        title="Footers"
        emptyLabel="No existing footers"
        parts={footers}
        onChange={onFooterChange}
      />
      <DocxCommentGroup
        comments={comments}
        onChange={onCommentChange}
        onDelete={onCommentDelete}
      />
      <DocxNoteGroup
        title="Footnotes"
        emptyLabel="No existing footnotes"
        notes={footnotes}
        onChange={onFootnoteChange}
        onDelete={onFootnoteDelete}
      />
      <DocxNoteGroup
        title="Endnotes"
        emptyLabel="No existing endnotes"
        notes={endnotes}
        onChange={onEndnoteChange}
        onDelete={onEndnoteDelete}
      />
      <DocxFieldGroup
        blocks={blocks}
        onInstructionChange={onFieldInstructionChange}
      />
      <DocxContentControlGroup
        blocks={blocks}
        onChange={onContentControlChange}
      />
      <DocxRevisionGroup
        blocks={blocks}
        onActionChange={onRevisionActionChange}
      />
    </div>
  );
}

function DocxTextPartGroup({
  title,
  emptyLabel,
  parts,
  onChange,
}: {
  title: string;
  emptyLabel: string;
  parts: DocxTextPart[];
  onChange: (index: number, text: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</div>
      <div className="space-y-2">
        {parts.map((part, index) => (
          <label key={part.path} className="block">
            <span className="mb-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
                {part.path}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    index,
                    part.text
                      ? `${part.text} ${DOCX_PAGE_FIELD_TOKEN}`
                      : DOCX_PAGE_FIELD_TOKEN,
                  )
                }
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-1.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                title="Insert page number"
              >
                <Hash className="h-3 w-3" strokeWidth={1.75} />
                Page
              </button>
            </span>
            <textarea
              value={part.text}
              onChange={(event) => onChange(index, event.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        ))}
        {parts.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

function DocxRevisionGroup({
  blocks,
  onActionChange,
}: {
  blocks: DocxBlock[];
  onActionChange: (
    blockIndex: number,
    revisionIndex: number,
    action: DocxRevision["action"],
  ) => void;
}) {
  const revisions = blocks.flatMap((block, blockIndex) =>
    (block.revisions ?? []).map((revision, revisionIndex) => ({
      block,
      blockIndex,
      revision,
      revisionIndex,
    })),
  );
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">Revisions</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {revisions.map(({ block, blockIndex, revision, revisionIndex }) => (
          <div
            key={`${block.id}-${revision.id}`}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-faint)]">
                {revision.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-muted)]">
                {revision.author ?? revision.revisionId ?? block.id}
              </span>
            </div>
            <div className="mb-2 line-clamp-2 text-xs text-[var(--text)]">
              {revision.text}
            </div>
            <div className="flex flex-wrap gap-1">
              {(["accept", "reject"] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => onActionChange(blockIndex, revisionIndex, action)}
                  className={cn(
                    "rounded-md border border-[var(--border)] px-2 py-1 text-[10px] capitalize text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                    revision.action === action &&
                      "border-[var(--accent)] text-[var(--accent)]",
                  )}
                >
                  {action}
                </button>
              ))}
              {revision.action && (
                <button
                  type="button"
                  onClick={() => onActionChange(blockIndex, revisionIndex, undefined)}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        ))}
        {revisions.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            No existing revisions
          </div>
        )}
      </div>
    </section>
  );
}

function DocxContentControlGroup({
  blocks,
  onChange,
}: {
  blocks: DocxBlock[];
  onChange: (
    blockIndex: number,
    controlIndex: number,
    patch: Partial<DocxContentControl>,
  ) => void;
}) {
  const controls = blocks.flatMap((block, blockIndex) =>
    (block.contentControls ?? []).map((control, controlIndex) => ({
      block,
      blockIndex,
      control,
      controlIndex,
    })),
  );
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">
        Content Controls
      </div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {controls.map(({ block, blockIndex, control, controlIndex }) => (
          <div
            key={`${block.id}-${control.id}`}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-faint)]">
                {control.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-muted)]">
                {control.alias ?? control.tag ?? control.controlId ?? block.id}
              </span>
            </div>
            {control.kind === "checkbox" && control.checked !== undefined && (
              <label className="mb-2 flex items-center gap-2 text-xs text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={control.checked}
                  onChange={(event) =>
                    onChange(blockIndex, controlIndex, {
                      checked: event.currentTarget.checked,
                    })
                  }
                />
                Checked
              </label>
            )}
            {control.items && control.items.length > 0 && (
              <select
                value={control.text ?? ""}
                onChange={(event) =>
                  onChange(blockIndex, controlIndex, {
                    text: event.currentTarget.value,
                  })
                }
                className="mb-2 h-7 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {control.items.map((item) => (
                  <option
                    key={`${item.value}-${item.displayText ?? ""}`}
                    value={item.displayText ?? item.value}
                  >
                    {item.displayText ?? item.value}
                  </option>
                ))}
              </select>
            )}
            {control.kind !== "checkbox" && !control.items?.length && (
              <input
                value={control.text ?? ""}
                onChange={(event) =>
                  onChange(blockIndex, controlIndex, {
                    text: event.currentTarget.value,
                  })
                }
                className="h-7 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
            {control.kind === "checkbox" && control.text && (
              <div className="truncate text-[10px] text-[var(--text-faint)]">
                {control.text}
              </div>
            )}
          </div>
        ))}
        {controls.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            No existing content controls
          </div>
        )}
      </div>
    </section>
  );
}

function DocxFieldGroup({
  blocks,
  onInstructionChange,
}: {
  blocks: DocxBlock[];
  onInstructionChange: (
    blockIndex: number,
    fieldIndex: number,
    instruction: string,
  ) => void;
}) {
  const fields = blocks.flatMap((block, blockIndex) =>
    (block.fields ?? []).map((field, fieldIndex) => ({
      block,
      blockIndex,
      field,
      fieldIndex,
    })),
  );
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">Fields</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {fields.map(({ block, blockIndex, field, fieldIndex }) => (
          <div
            key={`${block.id}-${field.id}`}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-faint)]">
                {field.kind ?? "FIELD"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-muted)]">
                {block.text || block.id}
              </span>
            </div>
            <textarea
              value={field.instruction}
              readOnly={field.source !== "simple"}
              onChange={(event) =>
                onInstructionChange(blockIndex, fieldIndex, event.target.value)
              }
              rows={2}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px] leading-4 text-[var(--text)] outline-none focus:border-[var(--accent)] read-only:text-[var(--text-muted)]"
            />
            {field.resultText && (
              <div className="mt-2 truncate text-[10px] text-[var(--text-faint)]">
                {field.resultText}
              </div>
            )}
          </div>
        ))}
        {fields.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            No existing fields
          </div>
        )}
      </div>
    </section>
  );
}

function DocxCommentGroup({
  comments,
  onChange,
  onDelete,
}: {
  comments: DocxComment[];
  onChange: (index: number, patch: Partial<DocxComment>) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">Comments</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {comments.map((comment, index) => (
          <div
            key={comment.id}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
                #{comment.id}
              </span>
              <input
                value={comment.author ?? ""}
                onChange={(event) => onChange(index, { author: event.target.value })}
                placeholder="Author"
                className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => onDelete(index)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
                title="Delete comment"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            {comment.date && (
              <input
                value={comment.date}
                onChange={(event) => onChange(index, { date: event.target.value })}
                className="mb-2 h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-[10px] text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
            )}
            <textarea
              value={comment.text}
              onChange={(event) => onChange(index, { text: event.target.value })}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        ))}
        {comments.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            No existing comments
          </div>
        )}
      </div>
    </section>
  );
}

function DocxNoteGroup({
  title,
  emptyLabel,
  notes,
  onChange,
  onDelete,
}: {
  title: string;
  emptyLabel: string;
  notes: DocxNote[];
  onChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-[var(--text)]">{title}</div>
      <div className="max-h-64 space-y-2 overflow-auto pr-1">
        {notes.map((note, index) => (
          <div
            key={note.id}
            className="block rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
          >
            <span className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--text-faint)]">
              <span>#{note.id}</span>
              <button
                type="button"
                onClick={() => onDelete(index)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
                title={`Delete ${title.toLowerCase()}`}
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </span>
            <textarea
              value={note.text}
              onChange={(event) => onChange(index, event.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        ))}
        {notes.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--text-faint)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}
