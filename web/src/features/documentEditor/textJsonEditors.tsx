import { useMemo, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Minus,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isRecord } from "./models";
import {
  JsonBreadcrumb,
  JsonDeleteButton,
  JsonDragHandle,
  JsonIconButton,
} from "./textJsonEditorControls";
import {
  isJsonContainer,
  jsonPathKey,
  startJsonDataDrag,
  toolbarTextButtonClass,
} from "./textJsonEditorControlUtils";
import {
  cloneJsonValue,
  coerceJsonEditorValue,
  deleteJsonPathValue,
  firstJsonChildPathSegment,
  getJsonPathValue,
  insertJsonObjectEntry,
  jsonCellToString,
  jsonEditorValueType,
  jsonPathExists,
  jsonPathLabel,
  jsonPathsEqual,
  jsonPrimitiveClass,
  parentJsonPath,
  parseJsonCell,
  parseJsonContent,
  setJsonPathValue,
  sortJsonValue,
  tabularJsonModel,
} from "./textJsonUtils";
import type { JsonPathSegment, JsonTableRow } from "./textJsonUtils";
export { JsonPreview } from "./jsonPreview";

export function StructuredJsonEditor({
  content,
  onChangeContent,
}: {
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<JsonPathSegment[]>([]);
  const [collapsedPathKeys, setCollapsedPathKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [objectKeyDraft, setObjectKeyDraft] = useState("");
  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(content || "null") };
    } catch {
      return { ok: false };
    }
  }, [content]);

  if (!parsed.ok) {
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

  const rootValue = parsed.value;
  const currentPath = jsonPathExists(rootValue, selectedPath)
    ? selectedPath
    : parentJsonPath(selectedPath);

  function updateValue(next: unknown) {
    onChangeContent(`${JSON.stringify(next, null, 2)}\n`);
  }

  function updateSelected(next: unknown) {
    updateValue(setJsonPathValue(rootValue, currentPath, next));
  }

  function objectKeyFor(value: Record<string, unknown>) {
    const key = objectKeyDraft.trim();
    if (!key || key in value) return null;
    return key;
  }

  function clearObjectKeyDraft() {
    setObjectKeyDraft("");
  }

  function toggleCollapsedPath(path: JsonPathSegment[], collapsed?: boolean) {
    const key = jsonPathKey(path);
    setCollapsedPathKeys((current) => {
      const next = new Set(current);
      const shouldCollapse = collapsed ?? !next.has(key);
      if (shouldCollapse) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function addChild() {
    const selected = getJsonPathValue(rootValue, currentPath);
    if (Array.isArray(selected)) {
      const nextPath = [...currentPath, selected.length];
      updateSelected([...selected, ""]);
      setSelectedPath(nextPath);
      return;
    }
    if (isRecord(selected)) {
      const key = objectKeyFor(selected);
      if (!key) return;
      updateSelected({ ...selected, [key]: "" });
      setSelectedPath([...currentPath, key]);
      clearObjectKeyDraft();
    }
  }

  function addSibling() {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    if (Array.isArray(parent) && typeof key === "number") {
      const next = [...parent];
      next.splice(key + 1, 0, "");
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, key + 1]);
      return;
    }
    if (isRecord(parent)) {
      const nextKey = objectKeyFor(parent);
      if (!nextKey) return;
      const next = insertJsonObjectEntry(parent, String(key), nextKey, "");
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextKey]);
      clearObjectKeyDraft();
    }
  }

  function duplicateSelected() {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    const selected = getJsonPathValue(rootValue, currentPath);
    if (Array.isArray(parent) && typeof key === "number") {
      const next = [...parent];
      next.splice(key + 1, 0, cloneJsonValue(selected));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, key + 1]);
      return;
    }
    if (isRecord(parent)) {
      const nextKey = objectKeyFor(parent);
      if (!nextKey) return;
      const next = insertJsonObjectEntry(parent, String(key), nextKey, cloneJsonValue(selected));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextKey]);
      clearObjectKeyDraft();
    }
  }

  function deleteSelected() {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    updateValue(deleteJsonPathValue(rootValue, currentPath));
    setSelectedPath(parentPath);
  }

  function moveSelected(direction: -1 | 1) {
    if (currentPath.length === 0) return;
    const parentPath = parentJsonPath(currentPath);
    const parent = getJsonPathValue(rootValue, parentPath);
    const key = currentPath[currentPath.length - 1];
    if (Array.isArray(parent) && typeof key === "number") {
      const nextIndex = key + direction;
      if (nextIndex < 0 || nextIndex >= parent.length) return;
      const next = [...parent];
      const [moved] = next.splice(key, 1);
      next.splice(nextIndex, 0, moved);
      updateValue(setJsonPathValue(rootValue, parentPath, next));
      setSelectedPath([...parentPath, nextIndex]);
      return;
    }
    if (isRecord(parent)) {
      const keys = Object.keys(parent);
      const index = keys.indexOf(String(key));
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= keys.length) return;
      const nextKeys = [...keys];
      const [moved] = nextKeys.splice(index, 1);
      nextKeys.splice(nextIndex, 0, moved);
      const next = Object.fromEntries(nextKeys.map((itemKey) => [itemKey, parent[itemKey]]));
      updateValue(setJsonPathValue(rootValue, parentPath, next));
    }
  }

  function sortSelectedKeys() {
    const selected = getJsonPathValue(rootValue, currentPath);
    if (!isRecord(selected)) return;
    updateSelected(sortJsonValue(selected));
  }

  function selectParent() {
    setSelectedPath(parentJsonPath(currentPath));
  }

  function selectFirstChild() {
    const selected = getJsonPathValue(rootValue, currentPath);
    const child = firstJsonChildPathSegment(selected);
    if (child !== null) setSelectedPath([...currentPath, child]);
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const primary = event.ctrlKey || event.metaKey;
    if (event.key === "Insert") {
      event.preventDefault();
      addSibling();
    } else if (primary && event.key === "Enter") {
      event.preventDefault();
      addChild();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveSelected(-1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveSelected(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const selected = getJsonPathValue(rootValue, currentPath);
      const pathKey = jsonPathKey(currentPath);
      if (
        isJsonContainer(selected) &&
        !collapsedPathKeys.has(pathKey)
      ) {
        toggleCollapsedPath(currentPath, true);
      } else {
        selectParent();
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const selected = getJsonPathValue(rootValue, currentPath);
      const pathKey = jsonPathKey(currentPath);
      if (
        isJsonContainer(selected) &&
        collapsedPathKeys.has(pathKey)
      ) {
        toggleCollapsedPath(currentPath, false);
      } else {
        selectFirstChild();
      }
    }
  }

  const selectedValue = getJsonPathValue(rootValue, currentPath);
  const selectedType = jsonEditorValueType(selectedValue);
  const parentValue =
    currentPath.length > 0
      ? getJsonPathValue(rootValue, parentJsonPath(currentPath))
      : null;
  const childKeyReady =
    !isRecord(selectedValue) || Boolean(objectKeyDraft.trim() && !(objectKeyDraft.trim() in selectedValue));
  const siblingKeyReady =
    !isRecord(parentValue) || Boolean(objectKeyDraft.trim() && !(objectKeyDraft.trim() in parentValue));
  const canAddChild =
    Array.isArray(selectedValue) || (isRecord(selectedValue) && childKeyReady);
  const canSortKeys = isRecord(selectedValue);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <JsonBreadcrumb path={currentPath} onSelect={setSelectedPath} />
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={objectKeyDraft}
            onChange={(event) => setObjectKeyDraft(event.target.value)}
            placeholder="Object key"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={addSibling}
            disabled={currentPath.length === 0 || !siblingKeyReady}
            className={toolbarTextButtonClass(false)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Sibling
          </button>
          <button
            type="button"
            onClick={addChild}
            disabled={!canAddChild}
            className={toolbarTextButtonClass(false)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Child
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            disabled={currentPath.length === 0 || !siblingKeyReady}
            className={toolbarTextButtonClass(false)}
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            Duplicate
          </button>
          <button
            type="button"
            onClick={sortSelectedKeys}
            disabled={!canSortKeys}
            className={toolbarTextButtonClass(false)}
          >
            <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
            Sort
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={currentPath.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <JsonEditableValue
            value={rootValue}
            path={[]}
            selectedPath={currentPath}
            collapsedPathKeys={collapsedPathKeys}
            onSelect={setSelectedPath}
            onChange={updateValue}
            onToggleCollapsed={toggleCollapsedPath}
          />
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)]">
            Inspector
          </div>
          <div className="space-y-3 p-3 text-xs text-[var(--text-muted)]">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Path
              </div>
              <code className="block break-all rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text)]">
                {jsonPathLabel(currentPath)}
              </code>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                Type
              </span>
              <select
                value={selectedType}
                onChange={(event) =>
                  updateSelected(coerceJsonEditorValue(selectedValue, event.target.value))
                }
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="object">object</option>
                <option value="array">array</option>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="null">null</option>
              </select>
            </label>
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] leading-5 text-[var(--text-faint)]">
              Insert adds a sibling. Ctrl/Cmd+Enter adds a child. Alt+Up/Down
              reorders the selected node.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function JsonTableEditor({
  content,
  onChangeContent,
}: {
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const [newColumnKey, setNewColumnKey] = useState("");
  const [newRowKey, setNewRowKey] = useState("");
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [columnDropKey, setColumnDropKey] = useState<string | null>(null);
  const [draggedRowIndex, setDraggedRowIndex] = useState<number | null>(null);
  const [rowDropIndex, setRowDropIndex] = useState<number | null>(null);
  const parsed = parseJsonContent(content);
  const table = tabularJsonModel(parsed);
  if (!table) {
    return (
      <div className="h-full overflow-auto p-4 text-sm text-[var(--text-muted)]">
        JSON table mode requires a root array of objects or an object whose
        values are objects.
      </div>
    );
  }
  const tableModel = table;
  const { rows, columns } = tableModel;
  const cleanNewColumnKey = newColumnKey.trim();
  const cleanNewRowKey = newRowKey.trim();
  const canAddColumn = Boolean(cleanNewColumnKey && !columns.includes(cleanNewColumnKey));
  const existingRowKeys = new Set(rows.map((row) => row.key).filter(Boolean));
  const canUseRowKey =
    tableModel.kind === "array" ||
    Boolean(cleanNewRowKey && !existingRowKeys.has(cleanNewRowKey));

  function updateRows(nextRows: JsonTableRow[]) {
    if (tableModel.kind === "array") {
      onChangeContent(`${JSON.stringify(nextRows.map((row) => row.value), null, 2)}\n`);
      return;
    }
    onChangeContent(
      `${JSON.stringify(
        Object.fromEntries(
          nextRows
            .filter((row) => row.key?.trim())
            .map((row) => [row.key?.trim() ?? "", row.value]),
        ),
        null,
        2,
      )}\n`,
    );
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex
          ? {
              ...row,
              value: {
                ...row.value,
                [key]: parseJsonCell(value, row.value[key]),
              },
            }
          : row,
      ),
    );
  }

  function renameRowKey(rowIndex: number, nextKey: string) {
    const cleanKey = nextKey.trim();
    if (tableModel.kind !== "object" || !cleanKey) return;
    if (rows.some((row, index) => index !== rowIndex && row.key === cleanKey)) return;
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex ? { ...row, key: cleanKey } : row,
      ),
    );
  }

  function renameColumn(currentKey: string, nextKey: string) {
    if (!nextKey.trim() || currentKey === nextKey) return;
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row.value)) {
          next[key === currentKey ? nextKey : key] = value;
        }
        if (!(currentKey in row.value)) next[nextKey] = "";
        return { ...row, value: next };
      }),
    );
  }

  function addColumn() {
    if (!canAddColumn) return;
    const nextKey = cleanNewColumnKey;
    updateRows(rows.map((row) => ({ ...row, value: { ...row.value, [nextKey]: "" } })));
    setNewColumnKey("");
  }

  function duplicateColumn(key: string) {
    if (!canAddColumn) return;
    const nextKey = cleanNewColumnKey;
    updateRows(
      rows.map((row) => ({
        ...row,
        value: { ...row.value, [nextKey]: cloneJsonValue(row.value[key]) },
      })),
    );
    setNewColumnKey("");
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const index = columns.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(index, 1);
    nextColumns.splice(nextIndex, 0, moved);
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        nextColumns.forEach((column) => {
          next[column] = row.value[column];
        });
        return { ...row, value: next };
      }),
    );
  }

  function reorderColumn(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const fromIndex = columns.indexOf(fromKey);
    const toIndex = columns.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, moved);
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        nextColumns.forEach((column) => {
          next[column] = row.value[column];
        });
        return { ...row, value: next };
      }),
    );
  }

  function deleteColumn(key: string) {
    updateRows(
      rows.map((row) => {
        const next = { ...row.value };
        delete next[key];
        return { ...row, value: next };
      }),
    );
  }

  function addRow() {
    if (!canUseRowKey) return;
    const emptyValue = Object.fromEntries(columns.map((column) => [column, ""]));
    updateRows([
      ...rows,
      {
        key: tableModel.kind === "object" ? cleanNewRowKey : undefined,
        value: emptyValue,
      },
    ]);
    setNewRowKey("");
  }

  function duplicateRow(index: number) {
    if (!canUseRowKey) return;
    updateRows([
      ...rows.slice(0, index + 1),
      {
        key: tableModel.kind === "object" ? cleanNewRowKey : undefined,
        value: cloneJsonValue(rows[index]?.value ?? {}) as Record<string, unknown>,
      },
      ...rows.slice(index + 1),
    ]);
    setNewRowKey("");
  }

  function moveRow(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    reorderRow(index, nextIndex);
  }

  function reorderRow(index: number, nextIndex: number) {
    if (index === nextIndex || index < 0 || nextIndex < 0) return;
    if (index >= rows.length || nextIndex >= rows.length) return;
    const nextRows = [...rows];
    const [moved] = nextRows.splice(index, 1);
    nextRows.splice(nextIndex, 0, moved);
    updateRows(nextRows);
  }

  function deleteRow(index: number) {
    updateRows(rows.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {tableModel.kind === "object" && (
          <input
            value={newRowKey}
            onChange={(event) => setNewRowKey(event.target.value)}
            placeholder="Row key"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <button
          type="button"
          onClick={addRow}
          disabled={!canUseRowKey}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add row
        </button>
        <input
          value={newColumnKey}
          onChange={(event) => setNewColumnKey(event.target.value)}
          placeholder="Column key"
          className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={addColumn}
          disabled={!canAddColumn}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add column
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-collapse text-xs shadow-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-12 border border-[var(--border)] bg-[var(--surface)]" />
              {tableModel.kind === "object" && (
                <th className="sticky top-0 z-10 min-w-36 border border-[var(--border)] bg-[var(--surface)] p-1 font-mono text-[var(--text-muted)]">
                  key
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column}
                  onDragOver={(event) => {
                    if (draggedColumnKey === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setColumnDropKey(column);
                  }}
                  onDragLeave={(event) => {
                    event.stopPropagation();
                    setColumnDropKey((current) => (current === column ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (draggedColumnKey !== null) reorderColumn(draggedColumnKey, column);
                    setDraggedColumnKey(null);
                    setColumnDropKey(null);
                  }}
                  className={cn(
                    "sticky top-0 z-10 min-w-40 border border-[var(--border)] bg-[var(--surface)] p-1",
                    columnDropKey === column && "bg-[var(--accent)]/10",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <JsonDragHandle
                      label="Drag column"
                      onDragStart={(event) => {
                        setDraggedColumnKey(column);
                        startJsonDataDrag(event, `column:${column}`);
                      }}
                      onDragEnd={() => {
                        setDraggedColumnKey(null);
                        setColumnDropKey(null);
                      }}
                    />
                    <input
                      value={column}
                      onChange={(event) => renameColumn(column, event.target.value)}
                      className="min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none"
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === 0}
                      icon={ArrowLeft}
                      label="Move column left"
                      onClick={() => moveColumn(column, -1)}
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === columns.length - 1}
                      icon={ArrowRight}
                      label="Move column right"
                      onClick={() => moveColumn(column, 1)}
                    />
                    <JsonIconButton
                      disabled={!canAddColumn}
                      icon={Copy}
                      label="Duplicate column"
                      onClick={() => duplicateColumn(column)}
                    />
                    <JsonDeleteButton onClick={() => deleteColumn(column)} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onDragOver={(event) => {
                  if (draggedRowIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setRowDropIndex(rowIndex);
                }}
                onDragLeave={(event) => {
                  event.stopPropagation();
                  setRowDropIndex((current) => (current === rowIndex ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedRowIndex !== null) reorderRow(draggedRowIndex, rowIndex);
                  setDraggedRowIndex(null);
                  setRowDropIndex(null);
                }}
                className={cn(rowDropIndex === rowIndex && "bg-[var(--accent)]/10")}
              >
                <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)]">
                  <div className="flex items-center gap-1">
                    <JsonDragHandle
                      label="Drag row"
                      onDragStart={(event) => {
                        setDraggedRowIndex(rowIndex);
                        startJsonDataDrag(event, `row:${rowIndex}`);
                      }}
                      onDragEnd={() => {
                        setDraggedRowIndex(null);
                        setRowDropIndex(null);
                      }}
                    />
                    <span className="min-w-6 text-right">{rowIndex + 1}</span>
                    <JsonIconButton
                      disabled={rowIndex === 0}
                      icon={ArrowUp}
                      label="Move row up"
                      onClick={() => moveRow(rowIndex, -1)}
                    />
                    <JsonIconButton
                      disabled={rowIndex === rows.length - 1}
                      icon={ArrowDown}
                      label="Move row down"
                      onClick={() => moveRow(rowIndex, 1)}
                    />
                    <JsonIconButton
                      disabled={!canUseRowKey}
                      icon={Copy}
                      label="Duplicate row"
                      onClick={() => duplicateRow(rowIndex)}
                    />
                    <JsonDeleteButton onClick={() => deleteRow(rowIndex)} />
                  </div>
                </th>
                {tableModel.kind === "object" && (
                  <td className="border border-[var(--border)] p-0">
                    <input
                      value={row.key ?? ""}
                      onChange={(event) => renameRowKey(rowIndex, event.target.value)}
                      className="h-8 min-w-36 bg-[var(--bg)] px-2 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column} className="border border-[var(--border)] p-0">
                    <input
                      value={jsonCellToString(row.value[column])}
                      onChange={(event) =>
                        updateCell(rowIndex, column, event.target.value)
                      }
                      className="h-8 min-w-40 bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length + (tableModel.kind === "object" ? 2 : 1))}
                  className="border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]"
                >
                  Empty table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JsonEditableValue({
  value,
  onChange,
  onDelete,
  path,
  selectedPath,
  collapsedPathKeys,
  onSelect,
  onToggleCollapsed,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onDelete?: () => void;
  path: JsonPathSegment[];
  selectedPath: JsonPathSegment[];
  collapsedPathKeys: ReadonlySet<string>;
  onSelect: (path: JsonPathSegment[]) => void;
  onToggleCollapsed: (path: JsonPathSegment[], collapsed?: boolean) => void;
}) {
  const [newObjectKey, setNewObjectKey] = useState("");
  const [draggedArrayIndex, setDraggedArrayIndex] = useState<number | null>(null);
  const [arrayDropIndex, setArrayDropIndex] = useState<number | null>(null);
  const [draggedObjectKey, setDraggedObjectKey] = useState<string | null>(null);
  const [objectDropKey, setObjectDropKey] = useState<string | null>(null);
  const selected = jsonPathsEqual(path, selectedPath);
  const collapsed = collapsedPathKeys.has(jsonPathKey(path));
  function startJsonDrag(
    event: ReactDragEvent<HTMLButtonElement>,
    payload: string,
  ) {
    event.stopPropagation();
    startJsonDataDrag(event, payload);
  }

  function reorderArrayItem(fromIndex: number, toIndex: number) {
    if (!Array.isArray(value)) return;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= value.length || toIndex >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
    onSelect([...path, toIndex]);
  }

  function reorderObjectEntry(fromKey: string, toKey: string) {
    if (!isRecord(value) || fromKey === toKey) return;
    const keys = Object.keys(value);
    const fromIndex = keys.indexOf(fromKey);
    const toIndex = keys.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextKeys = [...keys];
    const [moved] = nextKeys.splice(fromIndex, 1);
    nextKeys.splice(toIndex, 0, moved);
    onChange(Object.fromEntries(nextKeys.map((key) => [key, value[key]])));
    onSelect([...path, fromKey]);
  }

  if (Array.isArray(value)) {
    return (
      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onSelect(path);
        }}
        className={cn(
          "space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3",
          selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
        )}
      >
        <JsonContainerHeader
          kind="array"
          path={path}
          count={value.length}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
        />
        {!collapsed && value.map((item, index) => (
          <div
            key={index}
            onDragOver={(event) => {
              if (draggedArrayIndex === null) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setArrayDropIndex(index);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              setArrayDropIndex((current) => (current === index ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (draggedArrayIndex !== null) {
                reorderArrayItem(draggedArrayIndex, index);
              }
              setDraggedArrayIndex(null);
              setArrayDropIndex(null);
            }}
            className={cn(
              "grid gap-2 rounded-md md:grid-cols-[136px_minmax(0,1fr)]",
              arrayDropIndex === index && "bg-[var(--accent)]/10",
            )}
          >
            <div className="mt-0.5 flex items-center gap-1">
              <JsonDragHandle
                label="Drag item"
                onDragStart={(event) => {
                  setDraggedArrayIndex(index);
                  startJsonDrag(event, `array:${index}`);
                }}
                onDragEnd={() => {
                  setDraggedArrayIndex(null);
                  setArrayDropIndex(null);
                }}
              />
              <span className="min-w-6 text-right font-mono text-[10px] text-[var(--text-faint)]">
                {index}
              </span>
              <JsonIconButton
                disabled={index === 0}
                icon={ArrowUp}
                label="Move item up"
                onClick={() => {
                  const next = [...value];
                  const [moved] = next.splice(index, 1);
                  next.splice(index - 1, 0, moved);
                  onChange(next);
                }}
              />
              <JsonIconButton
                disabled={index === value.length - 1}
                icon={ArrowDown}
                label="Move item down"
                onClick={() => {
                  const next = [...value];
                  const [moved] = next.splice(index, 1);
                  next.splice(index + 1, 0, moved);
                  onChange(next);
                }}
              />
              <JsonIconButton
                icon={Copy}
                label="Duplicate item"
                onClick={() =>
                  onChange([
                    ...value.slice(0, index + 1),
                    cloneJsonValue(item),
                    ...value.slice(index + 1),
                  ])
                }
              />
              <JsonDeleteButton
                onClick={() =>
                  onChange(value.filter((_, currentIndex) => currentIndex !== index))
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <JsonEditableValue
                value={item}
                path={[...path, index]}
                selectedPath={selectedPath}
                collapsedPathKeys={collapsedPathKeys}
                onSelect={onSelect}
                onChange={(next) =>
                  onChange(
                    value.map((current, currentIndex) =>
                        currentIndex === index ? next : current,
                    ),
                  )
                }
                onToggleCollapsed={onToggleCollapsed}
              />
            </div>
          </div>
        ))}
        {!collapsed && (
          <button
            type="button"
            onClick={() => onChange([...value, ""])}
            className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Add item
          </button>
        )}
        {!collapsed && value.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">[]</span>
        )}
      </div>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    const cleanNewObjectKey = newObjectKey.trim();
    const canAddObjectKey = Boolean(cleanNewObjectKey && !(cleanNewObjectKey in value));
    return (
      <div
        onMouseDown={(event) => {
          event.stopPropagation();
          onSelect(path);
        }}
        className={cn(
          "space-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3",
          selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
        )}
      >
        <JsonContainerHeader
          kind="object"
          path={path}
          count={entries.length}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
        />
        {!collapsed && entries.map(([key, item]) => (
          <div
            key={key}
            onDragOver={(event) => {
              if (draggedObjectKey === null) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setObjectDropKey(key);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              setObjectDropKey((current) => (current === key ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (draggedObjectKey !== null) {
                reorderObjectEntry(draggedObjectKey, key);
              }
              setDraggedObjectKey(null);
              setObjectDropKey(null);
            }}
            className={cn(
              "grid gap-2 rounded-md md:grid-cols-[24px_minmax(120px,220px)_minmax(0,1fr)_auto]",
              objectDropKey === key && "bg-[var(--accent)]/10",
            )}
          >
            <JsonDragHandle
              label="Drag key"
              onDragStart={(event) => {
                setDraggedObjectKey(key);
                startJsonDrag(event, `object:${key}`);
              }}
              onDragEnd={() => {
                setDraggedObjectKey(null);
                setObjectDropKey(null);
              }}
            />
            <input
              value={key}
              onFocus={() => onSelect([...path, key])}
              onChange={(event) => {
                const nextKey = event.target.value;
                const next = { ...value };
                const currentValue = next[key];
                delete next[key];
                next[nextKey] = currentValue;
                onChange(next);
              }}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)]"
            />
            <div className="min-w-0">
              <JsonEditableValue
                value={item}
                path={[...path, key]}
                selectedPath={selectedPath}
                collapsedPathKeys={collapsedPathKeys}
                onSelect={onSelect}
                onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
                onDelete={() => {
                  const next = { ...value };
                  delete next[key];
                  onChange(next);
                }}
                onToggleCollapsed={onToggleCollapsed}
              />
            </div>
            <JsonDeleteButton
              onClick={() => {
                const next = { ...value };
                delete next[key];
                onChange(next);
              }}
            />
          </div>
        ))}
        {!collapsed && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={newObjectKey}
              onChange={(event) => setNewObjectKey(event.target.value)}
              placeholder="Object key"
              className="h-7 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => {
                if (!canAddObjectKey) return;
                onChange({ ...value, [cleanNewObjectKey]: "" });
                setNewObjectKey("");
              }}
              disabled={!canAddObjectKey}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3 w-3" strokeWidth={1.75} />
              Add key
            </button>
          </div>
        )}
        {!collapsed && entries.length === 0 && (
          <span className="font-mono text-xs text-[var(--text-faint)]">{"{}"}</span>
        )}
      </div>
    );
  }
  return (
    <JsonPrimitiveEditor
      value={value}
      path={path}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onChange={onChange}
      onDelete={onDelete}
    />
  );
}

function JsonContainerHeader({
  kind,
  path,
  count,
  collapsed,
  onToggleCollapsed,
}: {
  kind: "array" | "object";
  path: JsonPathSegment[];
  count: number;
  collapsed: boolean;
  onToggleCollapsed: (path: JsonPathSegment[], collapsed?: boolean) => void;
}) {
  const Icon = collapsed ? ArrowRight : ArrowDown;
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2">
      <button
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed(path);
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        aria-label={collapsed ? "Expand JSON node" : "Collapse JSON node"}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <span className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-faint)]">
        {kind}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-faint)]">
        {jsonPathLabel(path)}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
        {count} {kind === "array" ? "items" : "keys"}
      </span>
      {collapsed && (
        <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
          {kind === "array" ? "[...]" : "{...}"}
        </span>
      )}
    </div>
  );
}

function JsonPrimitiveEditor({
  value,
  onChange,
  onDelete,
  path,
  selectedPath,
  onSelect,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onDelete?: () => void;
  path: JsonPathSegment[];
  selectedPath: JsonPathSegment[];
  onSelect: (path: JsonPathSegment[]) => void;
}) {
  const type =
    value === null
      ? "null"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
  return (
    <div
      onMouseDown={(event) => {
        event.stopPropagation();
        onSelect(path);
      }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-transparent px-1 py-0.5",
        jsonPathsEqual(path, selectedPath) && "border-[var(--accent)] bg-[var(--bg)]",
      )}
    >
      <select
        value={type}
        onFocus={() => onSelect(path)}
        onChange={(event) => {
          const nextType = event.target.value;
          if (nextType === "string") onChange(String(value ?? ""));
          if (nextType === "number") onChange(Number(value) || 0);
          if (nextType === "boolean") onChange(Boolean(value));
          if (nextType === "null") onChange(null);
          if (nextType === "object") onChange({});
          if (nextType === "array") onChange([]);
        }}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
      >
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="null">null</option>
        <option value="object">object</option>
        <option value="array">array</option>
      </select>
      {type === "boolean" ? (
        <input
          type="checkbox"
          checked={value === true}
          onFocus={() => onSelect(path)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4"
        />
      ) : type === "null" ? (
        <span className="font-mono text-xs text-[var(--text-faint)]">null</span>
      ) : (
        <input
          value={type === "number" ? String(value ?? 0) : String(value ?? "")}
          onFocus={() => onSelect(path)}
          onChange={(event) =>
            onChange(type === "number" ? Number(event.target.value) : event.target.value)
          }
          className={cn(
            "min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]",
            jsonPrimitiveClass(value),
          )}
        />
      )}
      {onDelete && <JsonDeleteButton onClick={onDelete} />}
    </div>
  );
}
