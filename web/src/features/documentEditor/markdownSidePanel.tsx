import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  FrontmatterField,
  MarkdownHeadingAnchor,
  MarkdownFrontmatter,
  MarkdownHeading,
  MarkdownReference,
  MarkdownTableAlignment,
  MarkdownTableModel,
} from "./markdownEditorUtils";
import { MarkdownTablePanel } from "./markdownTablePanel";
import { ToolbarButton } from "./shared";

export type MarkdownSidePanelKind = "outline" | "frontmatter" | "references" | "table";

export function MarkdownSidePanel({
  panel,
  outline,
  headingAnchors,
  references,
  table,
  frontmatter,
  frontmatterFields,
  newFrontmatterKey,
  newFrontmatterValue,
  onClose,
  onFocusLine,
  onFocusRange,
  onCreateTable,
  onTableHeaderChange,
  onTableAlignmentChange,
  onTableCellChange,
  onTableAddRow,
  onTableDuplicateRow,
  onTableMoveRow,
  onTableDeleteRow,
  onTableAddColumn,
  onTableDuplicateColumn,
  onTableMoveColumn,
  onTableDeleteColumn,
  onFrontmatterBodyChange,
  onFrontmatterFieldChange,
  onFrontmatterFieldDelete,
  onFrontmatterFieldAdd,
  onFrontmatterRemove,
  onFrontmatterCreate,
  onNewFrontmatterKeyChange,
  onNewFrontmatterValueChange,
  onReferenceLabelChange,
  onReferenceTargetChange,
}: {
  panel: MarkdownSidePanelKind;
  outline: MarkdownHeading[];
  headingAnchors: MarkdownHeadingAnchor[];
  references: MarkdownReference[];
  table: MarkdownTableModel | null;
  frontmatter: MarkdownFrontmatter | null;
  frontmatterFields: FrontmatterField[];
  newFrontmatterKey: string;
  newFrontmatterValue: string;
  onClose: () => void;
  onFocusLine: (line: number) => void;
  onFocusRange: (start: number, end: number) => void;
  onCreateTable: () => void;
  onTableHeaderChange: (columnIndex: number, value: string) => void;
  onTableAlignmentChange: (
    columnIndex: number,
    alignment: MarkdownTableAlignment,
  ) => void;
  onTableCellChange: (rowIndex: number, columnIndex: number, value: string) => void;
  onTableAddRow: (afterRowIndex?: number) => void;
  onTableDuplicateRow: (rowIndex: number) => void;
  onTableMoveRow: (rowIndex: number, direction: -1 | 1) => void;
  onTableDeleteRow: (rowIndex: number) => void;
  onTableAddColumn: (afterColumnIndex?: number) => void;
  onTableDuplicateColumn: (columnIndex: number) => void;
  onTableMoveColumn: (columnIndex: number, direction: -1 | 1) => void;
  onTableDeleteColumn: (columnIndex: number) => void;
  onFrontmatterBodyChange: (body: string) => void;
  onFrontmatterFieldChange: (lineIndex: number, key: string, value: string) => void;
  onFrontmatterFieldDelete: (lineIndex: number) => void;
  onFrontmatterFieldAdd: () => void;
  onFrontmatterRemove: () => void;
  onFrontmatterCreate: () => void;
  onNewFrontmatterKeyChange: (value: string) => void;
  onNewFrontmatterValueChange: (value: string) => void;
  onReferenceLabelChange: (reference: MarkdownReference, value: string) => void;
  onReferenceTargetChange: (reference: MarkdownReference, value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
        <span className="text-xs font-semibold text-[var(--text)]">
          {panel === "outline"
            ? t("documentEditor.outline", { defaultValue: "Outline" })
            : panel === "references"
              ? t("documentEditor.references", { defaultValue: "References" })
              : panel === "table"
                ? t("documentEditor.table", { defaultValue: "Table" })
                : t("documentEditor.frontmatter", { defaultValue: "Frontmatter" })}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.close")}
        </button>
      </div>
      {panel === "outline" ? (
        <MarkdownOutlinePanel
          outline={outline}
          headingAnchors={headingAnchors}
          onFocusLine={onFocusLine}
        />
      ) : panel === "references" ? (
        <MarkdownReferencesPanel
          references={references}
          onFocusRange={onFocusRange}
          onLabelChange={onReferenceLabelChange}
          onTargetChange={onReferenceTargetChange}
        />
      ) : panel === "table" ? (
        <MarkdownTablePanel
          table={table}
          onCreate={onCreateTable}
          onHeaderChange={onTableHeaderChange}
          onAlignmentChange={onTableAlignmentChange}
          onCellChange={onTableCellChange}
          onAddRow={onTableAddRow}
          onDuplicateRow={onTableDuplicateRow}
          onMoveRow={onTableMoveRow}
          onDeleteRow={onTableDeleteRow}
          onAddColumn={onTableAddColumn}
          onDuplicateColumn={onTableDuplicateColumn}
          onMoveColumn={onTableMoveColumn}
          onDeleteColumn={onTableDeleteColumn}
        />
      ) : (
        <MarkdownFrontmatterPanel
          frontmatter={frontmatter}
          fields={frontmatterFields}
          newKey={newFrontmatterKey}
          newValue={newFrontmatterValue}
          onBodyChange={onFrontmatterBodyChange}
          onFieldChange={onFrontmatterFieldChange}
          onFieldDelete={onFrontmatterFieldDelete}
          onFieldAdd={onFrontmatterFieldAdd}
          onRemove={onFrontmatterRemove}
          onCreate={onFrontmatterCreate}
          onNewKeyChange={onNewFrontmatterKeyChange}
          onNewValueChange={onNewFrontmatterValueChange}
        />
      )}
    </aside>
  );
}

function MarkdownOutlinePanel({
  outline,
  headingAnchors,
  onFocusLine,
}: {
  outline: MarkdownHeading[];
  headingAnchors: MarkdownHeadingAnchor[];
  onFocusLine: (line: number) => void;
}) {
  const { t } = useTranslation();
  const anchorByLine = new Map(headingAnchors.map((anchor) => [anchor.line, anchor]));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {outline.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">
          {t("documentEditor.noOutline", { defaultValue: "No headings yet." })}
        </p>
      ) : (
        <div className="space-y-1">
          {outline.map((heading) => (
            <button
              key={`${heading.line}:${heading.text}`}
              type="button"
              onClick={() => onFocusLine(heading.line)}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 12 + 8}px` }}
            >
              <span className="block truncate">{heading.text}</span>
              {anchorByLine.get(heading.line) && (
                <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] text-[var(--text-faint)]">
                  <span className="truncate">#{anchorByLine.get(heading.line)?.id}</span>
                  {(anchorByLine.get(heading.line)?.duplicateCount ?? 0) > 1 && (
                    <span className="shrink-0 rounded border border-[var(--status-warning)]/40 px-1 text-[var(--status-warning)]">
                      {anchorByLine.get(heading.line)?.duplicateIndex}/
                      {anchorByLine.get(heading.line)?.duplicateCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkdownReferencesPanel({
  references,
  onFocusRange,
  onLabelChange,
  onTargetChange,
}: {
  references: MarkdownReference[];
  onFocusRange: (start: number, end: number) => void;
  onLabelChange: (reference: MarkdownReference, value: string) => void;
  onTargetChange: (reference: MarkdownReference, value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {references.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">
          {t("documentEditor.noReferences", {
            defaultValue: "No links, images, footnotes, or definitions yet.",
          })}
        </p>
      ) : (
        <div className="space-y-2">
          {references.map((reference) => (
            <div
              key={`${reference.kind}:${reference.line}:${reference.start}`}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-[var(--text)]">
                  {reference.label}
                </span>
                <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-faint)]">
                  {reference.kind}
                </span>
              </div>
              {reference.labelStart !== undefined &&
                reference.labelEnd !== undefined && (
                  <label className="mt-2 grid gap-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                    <span>
                      {reference.kind === "image"
                        ? "Alt"
                        : reference.kind === "footnote"
                          ? "Footnote"
                          : "Label"}
                    </span>
                    <input
                      value={markdownReferenceEditableLabel(reference)}
                      onChange={(event) =>
                        onLabelChange(reference, event.currentTarget.value)
                      }
                      className="h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                )}
              {reference.targetStart !== undefined &&
                reference.targetEnd !== undefined && (
                  <label className="mt-2 grid gap-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                    <span>
                      {reference.kind === "footnote" ? "Body" : "Target"}
                    </span>
                    {reference.kind === "footnote" ? (
                      <textarea
                        value={reference.target ?? ""}
                        rows={Math.min(
                          6,
                          Math.max(2, (reference.target ?? "").split("\n").length),
                        )}
                        onChange={(event) =>
                          onTargetChange(reference, event.currentTarget.value)
                        }
                        className="min-h-16 resize-y rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    ) : (
                      <input
                        value={reference.target ?? ""}
                        onChange={(event) =>
                          onTargetChange(reference, event.currentTarget.value)
                        }
                        className="h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs normal-case tracking-normal text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </label>
              )}
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--text-faint)]">
                <span>L{reference.line}</span>
                <button
                  type="button"
                  onClick={() => onFocusRange(reference.start, reference.end)}
                  className="rounded border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  {t("documentEditor.focusSource", { defaultValue: "Focus source" })}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function markdownReferenceEditableLabel(reference: MarkdownReference) {
  if (reference.kind === "footnote") {
    return reference.label.replace(/^\[\^/, "").replace(/\]$/, "");
  }
  return reference.label;
}

function MarkdownFrontmatterPanel({
  frontmatter,
  fields,
  newKey,
  newValue,
  onBodyChange,
  onFieldChange,
  onFieldDelete,
  onFieldAdd,
  onRemove,
  onCreate,
  onNewKeyChange,
  onNewValueChange,
}: {
  frontmatter: MarkdownFrontmatter | null;
  fields: FrontmatterField[];
  newKey: string;
  newValue: string;
  onBodyChange: (body: string) => void;
  onFieldChange: (lineIndex: number, key: string, value: string) => void;
  onFieldDelete: (lineIndex: number) => void;
  onFieldAdd: () => void;
  onRemove: () => void;
  onCreate: () => void;
  onNewKeyChange: (value: string) => void;
  onNewValueChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {frontmatter ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span className="font-medium uppercase tracking-wide">
              {frontmatter.format}
            </span>
            <span>
              {fields.length} {t("documentEditor.fields", { defaultValue: "fields" })}
            </span>
          </div>
          <textarea
            value={frontmatter.content}
            onChange={(event) => onBodyChange(event.target.value)}
            spellCheck={false}
            className="h-40 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          {fields.length > 0 && (
            <div className="space-y-2">
              {fields.map((field) => (
                <div
                  key={`${field.entryKind}:${field.lineIndex}:${field.key}`}
                  className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-1"
                >
                  <label className="grid gap-1">
                    <span className="truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                      {field.parentLabel}
                    </span>
                    <input
                      value={field.key}
                      disabled={!field.keyEditable}
                      onChange={(event) =>
                        onFieldChange(field.lineIndex, event.target.value, field.value)
                      }
                      className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                      {field.entryKind}
                    </span>
                    {field.value.includes("\n") ? (
                      <textarea
                        value={field.value}
                        onChange={(event) =>
                          onFieldChange(field.lineIndex, field.key, event.target.value)
                        }
                        className="min-h-20 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    ) : (
                      <input
                        value={field.value}
                        onChange={(event) =>
                          onFieldChange(field.lineIndex, field.key, event.target.value)
                        }
                        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </label>
                  <ToolbarButton
                    icon={Trash2}
                    label={t("common.delete")}
                    onClick={() => onFieldDelete(field.lineIndex)}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-1">
            <input
              value={newKey}
              onChange={(event) => onNewKeyChange(event.target.value)}
              placeholder={t("common.name")}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={newValue}
              onChange={(event) => onNewValueChange(event.target.value)}
              placeholder={t("documentEditor.value", { defaultValue: "Value" })}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <ToolbarButton
              icon={Plus}
              label={t("common.add")}
              onClick={onFieldAdd}
              disabled={!newKey.trim()}
            />
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("documentEditor.removeFrontmatter", { defaultValue: "Remove frontmatter" })}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--surface-hover)]"
        >
          {t("documentEditor.createFrontmatter", { defaultValue: "Create frontmatter" })}
        </button>
      )}
    </div>
  );
}
