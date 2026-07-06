import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Save,
  Columns3,
  Table,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import {
  useDocumentEditorModel,
  useWriteDocumentEditorModel,
} from "@/features/documentEditor/api";
import type {
  DocumentEditorKind,
  DocumentEditorModelResponse,
} from "@/types/documentEditor";

interface DocumentEditorPaneProps {
  path: string | null;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  variant?: "side" | "embedded";
}

interface TextModel {
  content: string;
}

interface DocxBlock {
  id: string;
  type: "paragraph" | "heading";
  text: string;
  bold?: boolean;
  italic?: boolean;
}

interface DocxModel {
  blocks: DocxBlock[];
}

interface XlsxCell {
  ref: string;
  value: string;
}

interface XlsxRow {
  index: string;
  cells: XlsxCell[];
}

interface XlsxSheet {
  id: string;
  name: string;
  rows: XlsxRow[];
}

interface XlsxModel {
  sheets: XlsxSheet[];
}

interface DelimitedTableModel {
  rows: string[][];
}

interface PptxText {
  id: string;
  text: string;
}

interface PptxSlide {
  id: string;
  name: string;
  texts: PptxText[];
}

interface PptxModel {
  slides: PptxSlide[];
}

export function DocumentEditorPane({
  path,
  onClose,
  onDirtyChange,
  variant = "side",
}: DocumentEditorPaneProps) {
  const { t } = useTranslation();
  const query = useDocumentEditorModel(path);
  const data = query.data ?? null;

  if (!path) return null;

  return (
    <aside
      className={cn(
        "flex h-full min-w-0 flex-col bg-[var(--bg)]",
        variant === "side" && "border-l border-[var(--border)]",
      )}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text)]">
            {data?.name ?? t("documentEditor.title")}
          </div>
          <div className="truncate font-mono text-[10px] text-[var(--text-faint)]">
            {path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("common.close")}
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {query.isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("common.loading")}
        </div>
      )}
      {query.isError && (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[var(--status-error)]">
          {t("documentEditor.loadError")}
        </div>
      )}
      {data && (
        <DocumentEditorContent
          key={`${data.path}:${data.fingerprint}`}
          data={data}
          onDirtyChange={onDirtyChange}
        />
      )}
    </aside>
  );
}

function DocumentEditorContent({
  data,
  onDirtyChange,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const writeModel = useWriteDocumentEditorModel();
  const [draft, setDraft] = useState<unknown>(() => data.model);
  const [baseKey, setBaseKey] = useState(() => stableJson(data.model));
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const draftKey = stableJson(draft);
  const dirty = draftKey !== baseKey;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!data || !dirty) return;
    const saved = await writeModel.mutateAsync({
      path: data.path,
      editorKind: data.editorKind,
      model: draft,
      expectedFingerprint: data.fingerprint,
    });
    setDraft(saved.model);
    setBaseKey(stableJson(saved.model));
    setLastSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-4 py-2">
        {dirty && (
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            {t("documentEditor.unsaved")}
          </span>
        )}
        {lastSavedAt && !dirty && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            <Check className="h-3 w-3" strokeWidth={1.75} />
            {t("documentEditor.savedAt", { time: lastSavedAt })}
          </span>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || writeModel.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {writeModel.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {t("common.save")}
        </button>
      </div>

      {writeModel.isError && (
        <div className="border-b border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.saveError")}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorBody
          path={data.path}
          kind={data.editorKind}
          model={draft}
          onChange={setDraft}
        />
      </div>
    </>
  );
}

function EditorBody({
  path,
  kind,
  model,
  onChange,
}: {
  path: string;
  kind: DocumentEditorKind;
  model: unknown;
  onChange: (model: unknown) => void;
}) {
  if (kind === "markdown") {
    return (
      <MarkdownRichEditor
        model={normalizeTextModel(model)}
        onChange={onChange}
      />
    );
  }
  if (kind === "text") {
    return (
      <PlainTextEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
      />
    );
  }
  if (kind === "csv" || kind === "tsv") {
    return (
      <DelimitedTableEditor
        model={normalizeDelimitedTableModel(model)}
        onChange={onChange}
      />
    );
  }
  if (kind === "docx") {
    return <DocxEditor model={normalizeDocxModel(model)} onChange={onChange} />;
  }
  if (kind === "xlsx") {
    return <XlsxEditor model={normalizeXlsxModel(model)} onChange={onChange} />;
  }
  if (kind === "pptx") {
    return <PptxEditor model={normalizePptxModel(model)} onChange={onChange} />;
  }
  return null;
}

function MarkdownRichEditor({
  model,
  onChange,
}: {
  model: TextModel;
  onChange: (model: TextModel) => void;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [preview, setPreview] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkInputOpen, setLinkInputOpen] = useState(false);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    editor.innerHTML = markdownToHtml(model.content);
  }, [model.content]);

  function run(command: string, value?: string) {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, value);
    sync();
  }

  function sync() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange({ content: htmlToMarkdown(editor) });
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current?.contains(range.commonAncestorContainer)) {
      selectionRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const range = selectionRef.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function submitLink() {
    const url = linkDraft.trim();
    if (!url) return;
    restoreSelection();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      run("createLink", url);
    } else {
      editorRef.current?.focus();
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
      );
      sync();
    }
    setLinkInputOpen(false);
    setLinkDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
        <ToolbarButton icon={Heading1} label="H1" onClick={() => run("formatBlock", "h1")} />
        <ToolbarButton icon={Heading2} label="H2" onClick={() => run("formatBlock", "h2")} />
        <ToolbarButton icon={Bold} label={t("documentEditor.bold")} onClick={() => run("bold")} />
        <ToolbarButton icon={Italic} label={t("documentEditor.italic")} onClick={() => run("italic")} />
        <ToolbarButton icon={List} label={t("documentEditor.bullets")} onClick={() => run("insertUnorderedList")} />
        <ToolbarButton icon={ListOrdered} label={t("documentEditor.numbered")} onClick={() => run("insertOrderedList")} />
        <ToolbarButton icon={Quote} label={t("documentEditor.quote")} onClick={() => run("formatBlock", "blockquote")} />
        <ToolbarButton icon={Code} label={t("documentEditor.code")} onClick={() => run("formatBlock", "pre")} />
        <ToolbarButton
          icon={Link}
          label={t("documentEditor.link")}
          onClick={() => {
            rememberSelection();
            setLinkInputOpen((current) => !current);
          }}
        />
        <ToolbarButton
          icon={Table}
          label={t("documentEditor.table")}
          onClick={() => {
            editorRef.current?.focus();
            document.execCommand(
              "insertHTML",
              false,
              "<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table>",
            );
            sync();
          }}
        />
        {linkInputOpen && (
          <form
            className="flex min-w-48 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitLink();
            }}
          >
            <input
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder={t("documentEditor.linkUrl")}
              className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              title={t("documentEditor.applyLink")}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => setPreview((current) => !current)}
          className="ml-auto rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          {preview ? t("documentEditor.edit") : t("documentEditor.preview")}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {preview ? (
          <article className="chat-markdown h-full min-h-0 overflow-y-auto p-5 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{model.content}</ReactMarkdown>
          </article>
        ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={rememberSelection}
            onKeyUp={rememberSelection}
            onMouseUp={rememberSelection}
            onInput={sync}
            className="h-full min-h-0 overflow-y-auto p-5 text-sm leading-7 text-[var(--text)] outline-none"
          />
        )}
      </div>
    </div>
  );
}

function PlainTextEditor({
  filePath,
  model,
  onChange,
}: {
  filePath: string;
  model: TextModel;
  onChange: (model: TextModel) => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  const json = isJsonPath(filePath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {json && (
        <div className="flex shrink-0 justify-end border-b border-[var(--border)] px-3 py-2">
          <button
            type="button"
            onClick={() => setPreview((current) => !current)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            {preview ? t("documentEditor.edit") : t("documentEditor.preview")}
          </button>
        </div>
      )}
      {preview && json ? (
        <JsonPreview content={model.content} />
      ) : (
        <textarea
          value={model.content}
          onChange={(event) => onChange({ content: event.target.value })}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-[var(--bg)] p-4 font-mono text-sm leading-6 text-[var(--text)] outline-none"
        />
      )}
    </div>
  );
}

function JsonPreview({ content }: { content: string }) {
  const { t } = useTranslation();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="mb-3 rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.invalidJson")}
        </div>
        <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
          {content}
        </pre>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-4">
      <JsonValueView value={parsed} />
    </div>
  );
}

function JsonValueView({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
        {value.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="mt-1 min-w-8 font-mono text-[10px] text-[var(--text-faint)]">
              {index}
            </span>
            <div className="min-w-0 flex-1">
              <JsonValueView value={item} />
            </div>
          </div>
        ))}
        {value.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">[]</span>
        )}
      </div>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return (
      <div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
        {entries.map(([key, item]) => (
          <div key={key} className="grid gap-2 md:grid-cols-[minmax(120px,220px)_minmax(0,1fr)]">
            <span className="break-all font-mono text-xs font-medium text-[var(--accent)]">
              {key}
            </span>
            <div className="min-w-0">
              <JsonValueView value={item} />
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">{"{}"}</span>
        )}
      </div>
    );
  }
  return (
    <span className={cn("font-mono text-xs", jsonPrimitiveClass(value))}>
      {formatJsonPrimitive(value)}
    </span>
  );
}

function DocxEditor({
  model,
  onChange,
}: {
  model: DocxModel;
  onChange: (model: DocxModel) => void;
}) {
  const { t } = useTranslation();

  function updateBlock(index: number, patch: Partial<DocxBlock>) {
    onChange({
      blocks: model.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } : block,
      ),
    });
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
        {model.blocks.map((block, index) => (
          <div key={block.id} className="group flex gap-2">
            <select
              value={block.type}
              onChange={(event) =>
                updateBlock(index, { type: event.target.value as DocxBlock["type"] })
              }
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text-muted)]"
            >
              <option value="paragraph">P</option>
              <option value="heading">H</option>
            </select>
            <div
              contentEditable
              suppressContentEditableWarning
              onInput={(event) =>
                updateBlock(index, { text: event.currentTarget.textContent ?? "" })
              }
              className={cn(
                "min-h-8 flex-1 rounded-md px-2 py-1 outline-none focus:bg-[var(--bg)]",
                block.type === "heading"
                  ? "text-lg font-semibold"
                  : "text-sm leading-7",
              )}
            >
              {block.text}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              blocks: [
                ...model.blocks,
                {
                  id: `p${Date.now()}`,
                  type: "paragraph",
                  text: "",
                },
              ],
            })
          }
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          {t("documentEditor.addParagraph")}
        </button>
      </div>
    </div>
  );
}

function XlsxEditor({
  model,
  onChange,
}: {
  model: XlsxModel;
  onChange: (model: XlsxModel) => void;
}) {
  const [preferredSheetId, setPreferredSheetId] = useState<string | null>(null);
  const sheet =
    model.sheets.find((item) => item.id === preferredSheetId) ?? model.sheets[0];

  function updateCell(rowIndex: number, cellIndex: number, value: string) {
    if (!sheet) return;
    onChange({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                  ? {
                      ...row,
                      cells: row.cells.map((cell, currentCellIndex) =>
                        currentCellIndex === cellIndex ? { ...cell, value } : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {model.sheets.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreferredSheetId(item.id)}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              item.id === sheet?.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-collapse text-xs">
          <tbody>
            {sheet?.rows.map((row, rowIndex) => (
              <tr key={`${sheet.id}:${row.index}:${rowIndex}`}>
                <th className="sticky left-0 border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)]">
                  {row.index || rowIndex + 1}
                </th>
                {row.cells.map((cell, cellIndex) => (
                  <td key={`${cell.ref}:${cellIndex}`} className="border border-[var(--border)]">
                    <input
                      value={cell.value}
                      onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)}
                      className="h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                      title={cell.ref}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DelimitedTableEditor({
  model,
  onChange,
}: {
  model: DelimitedTableModel;
  onChange: (model: DelimitedTableModel) => void;
}) {
  const { t } = useTranslation();
  const columnCount = Math.max(1, ...model.rows.map((row) => row.length));
  const rows = model.rows.length > 0 ? model.rows : [Array(columnCount).fill("")];

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    onChange({
      rows: rows.map((row, currentRowIndex) => {
        const normalized = normalizeRow(row, columnCount);
        if (currentRowIndex !== rowIndex) return normalized;
        return normalized.map((cell, currentColumnIndex) =>
          currentColumnIndex === columnIndex ? value : cell,
        );
      }),
    });
  }

  function addRow() {
    onChange({ rows: [...rows.map((row) => normalizeRow(row, columnCount)), Array(columnCount).fill("")] });
  }

  function addColumn() {
    onChange({ rows: rows.map((row) => [...normalizeRow(row, columnCount), ""]) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.addRow")}
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.addColumn")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-collapse text-xs">
          <tbody>
            {rows.map((row, rowIndex) => {
              const normalized = normalizeRow(row, columnCount);
              return (
                <tr key={rowIndex}>
                  <th className="sticky left-0 border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)]">
                    {rowIndex + 1}
                  </th>
                  {normalized.map((cell, columnIndex) => (
                    <td key={columnIndex} className="border border-[var(--border)]">
                      <input
                        value={cell}
                        onChange={(event) =>
                          updateCell(rowIndex, columnIndex, event.target.value)
                        }
                        className="h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                        aria-label={t("documentEditor.cellLabel", {
                          row: rowIndex + 1,
                          column: columnIndex + 1,
                        })}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PptxEditor({
  model,
  onChange,
}: {
  model: PptxModel;
  onChange: (model: PptxModel) => void;
}) {
  const { t } = useTranslation();
  const [preferredSlideId, setPreferredSlideId] = useState<string | null>(null);
  const slide =
    model.slides.find((item) => item.id === preferredSlideId) ?? model.slides[0];

  function updateText(textIndex: number, text: string) {
    if (!slide) return;
    onChange({
      slides: model.slides.map((item) =>
        item.id === slide.id
          ? {
              ...item,
              texts: item.texts.map((textItem, currentIndex) =>
                currentIndex === textIndex ? { ...textItem, text } : textItem,
              ),
            }
          : item,
      ),
    });
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-40 shrink-0 overflow-y-auto border-r border-[var(--border)] p-2">
        {model.slides.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreferredSlideId(item.id)}
            className={cn(
              "mb-2 block w-full rounded-md border px-2 py-3 text-left text-xs",
              item.id === slide?.id
                ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {t("documentEditor.slideLabel", { index: index + 1 })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto aspect-video max-w-3xl rounded-md border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="mb-4 text-xs text-[var(--text-faint)]">{slide?.name}</div>
          <div className="space-y-3">
            {slide?.texts.map((textItem, index) => (
              <textarea
                key={textItem.id}
                value={textItem.text}
                onChange={(event) => updateText(index, event.target.value)}
                className="min-h-14 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}

function normalizeTextModel(model: unknown): TextModel {
  if (isRecord(model) && typeof model.content === "string") {
    return { content: model.content };
  }
  return { content: "" };
}

function normalizeDocxModel(model: unknown): DocxModel {
  if (!isRecord(model) || !Array.isArray(model.blocks)) return { blocks: [] };
  return {
    blocks: model.blocks.map((block, index) => {
      const item = isRecord(block) ? block : {};
      return {
        id: typeof item.id === "string" ? item.id : `p${index + 1}`,
        type: item.type === "heading" ? "heading" : "paragraph",
        text: typeof item.text === "string" ? item.text : "",
        bold: item.bold === true,
        italic: item.italic === true,
      };
    }),
  };
}

function normalizeXlsxModel(model: unknown): XlsxModel {
  if (!isRecord(model) || !Array.isArray(model.sheets)) return { sheets: [] };
  return {
    sheets: model.sheets.map((sheet, sheetIndex) => {
      const item = isRecord(sheet) ? sheet : {};
      const rows = Array.isArray(item.rows) ? item.rows : [];
      return {
        id: typeof item.id === "string" ? item.id : `sheet${sheetIndex + 1}`,
        name:
          typeof item.name === "string" ? item.name : `sheet-${sheetIndex + 1}`,
        rows: rows.map((row, rowIndex) => {
          const rowItem = isRecord(row) ? row : {};
          const cells = Array.isArray(rowItem.cells) ? rowItem.cells : [];
          return {
            index: typeof rowItem.index === "string" ? rowItem.index : String(rowIndex + 1),
            cells: cells.map((cell, cellIndex) => {
              const cellItem = isRecord(cell) ? cell : {};
              return {
                ref: typeof cellItem.ref === "string" ? cellItem.ref : `C${cellIndex + 1}`,
                value: typeof cellItem.value === "string" ? cellItem.value : "",
              };
            }),
          };
        }),
      };
    }),
  };
}

function normalizeDelimitedTableModel(model: unknown): DelimitedTableModel {
  if (!isRecord(model) || !Array.isArray(model.rows)) return { rows: [[]] };
  return {
    rows: model.rows.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => (typeof cell === "string" ? cell : String(cell ?? "")))
        : [],
    ),
  };
}

function normalizePptxModel(model: unknown): PptxModel {
  if (!isRecord(model) || !Array.isArray(model.slides)) return { slides: [] };
  return {
    slides: model.slides.map((slide, slideIndex) => {
      const item = isRecord(slide) ? slide : {};
      const texts = Array.isArray(item.texts) ? item.texts : [];
      return {
        id: typeof item.id === "string" ? item.id : `slide${slideIndex + 1}`,
        name: typeof item.name === "string" ? item.name : `slide-${slideIndex + 1}`,
        texts: texts.map((text, textIndex) => {
          const textItem = isRecord(text) ? text : {};
          return {
            id: typeof textItem.id === "string" ? textItem.id : `t${textIndex + 1}`,
            text: typeof textItem.text === "string" ? textItem.text : "",
          };
        }),
      };
    }),
  };
}

function normalizeRow(row: string[], columnCount: number) {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  const codeLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre>${escapeHtml(codeLines.join("\n"))}</pre>`);
        codeLines.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${inlineMarkdownToHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${inlineMarkdownToHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("> ")) {
      closeList();
      html.push(`<blockquote>${inlineMarkdownToHtml(line.slice(2))}</blockquote>`);
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdownToHtml(line.slice(2))}</li>`);
    } else if (line.trim()) {
      closeList();
      html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return html.join("");

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }
}

function htmlToMarkdown(root: HTMLElement) {
  return Array.from(root.childNodes)
    .map(nodeToMarkdown)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const text = inlineNodesToMarkdown(node).trimEnd();
  switch (node.tagName.toLowerCase()) {
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "h3":
      return `### ${text}`;
    case "blockquote":
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "pre":
      return `\`\`\`\n${node.innerText.trimEnd()}\n\`\`\``;
    case "ul":
      return childHtmlElements(node, ":scope > li")
        .map((li) => `- ${inlineNodesToMarkdown(li).trimEnd()}`)
        .join("\n");
    case "ol":
      return childHtmlElements(node, ":scope > li")
        .map((li, index) => `${index + 1}. ${inlineNodesToMarkdown(li).trimEnd()}`)
        .join("\n");
    case "table":
      return tableToMarkdown(node);
    default:
      return text;
  }
}

function inlineMarkdownToHtml(markdown: string) {
  return escapeHtml(markdown)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function inlineNodesToMarkdown(root: HTMLElement) {
  return Array.from(root.childNodes).map(inlineNodeToMarkdown).join("");
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const content = inlineNodesToMarkdown(node);
  switch (node.tagName.toLowerCase()) {
    case "strong":
    case "b":
      return `**${content}**`;
    case "em":
    case "i":
      return `*${content}*`;
    case "code":
      return `\`${node.textContent ?? ""}\``;
    case "a": {
      const href = node.getAttribute("href") ?? "";
      const label = content || href;
      return href ? `[${label}](${href})` : label;
    }
    case "br":
      return "\n";
    default:
      return content;
  }
}

function childHtmlElements(root: HTMLElement, selector: string) {
  return Array.from(root.querySelectorAll(selector)).filter(
    (item): item is HTMLElement => item instanceof HTMLElement,
  );
}

function tableToMarkdown(table: HTMLElement) {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) =>
      inlineNodesToMarkdown(cell as HTMLElement).trim(),
    ),
  );
  if (rows.length === 0) return "";
  const header = rows[0];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isJsonPath(path: string) {
  return /\.json$/i.test(path);
}

function jsonPrimitiveClass(value: unknown) {
  if (typeof value === "string") return "text-[var(--status-success)]";
  if (typeof value === "number") return "text-[var(--accent)]";
  if (typeof value === "boolean") return "text-[var(--status-warning)]";
  if (value === null) return "text-[var(--text-faint)]";
  return "text-[var(--text-muted)]";
}

function formatJsonPrimitive(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function stableJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
