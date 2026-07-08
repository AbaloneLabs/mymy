import { Hash, Trash2 } from "lucide-react";
import type { DocxComment, DocxNote, DocxTextPart } from "./models";

const DOCX_PAGE_FIELD_TOKEN = "{PAGE}";

export function DocxTextPartsPanel({
  headers,
  footers,
  comments,
  footnotes,
  endnotes,
  onHeaderChange,
  onFooterChange,
  onCommentChange,
  onCommentDelete,
  onFootnoteChange,
  onFootnoteDelete,
  onEndnoteChange,
  onEndnoteDelete,
}: {
  headers: DocxTextPart[];
  footers: DocxTextPart[];
  comments: DocxComment[];
  footnotes: DocxNote[];
  endnotes: DocxNote[];
  onHeaderChange: (index: number, text: string) => void;
  onFooterChange: (index: number, text: string) => void;
  onCommentChange: (index: number, patch: Partial<DocxComment>) => void;
  onCommentDelete: (index: number) => void;
  onFootnoteChange: (index: number, text: string) => void;
  onFootnoteDelete: (index: number) => void;
  onEndnoteChange: (index: number, text: string) => void;
  onEndnoteDelete: (index: number) => void;
}) {
  return (
    <div className="grid shrink-0 gap-3 border-b border-[var(--border)] bg-[var(--surface)] p-3 lg:grid-cols-2 xl:grid-cols-5">
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
