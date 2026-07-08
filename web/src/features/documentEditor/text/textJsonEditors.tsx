import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowDownAZ,
  Copy,
  Minus,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isRecord } from "../shared/models";
import { JsonEditableValue } from "./jsonEditableValue";
import { JsonBreadcrumb } from "./textJsonEditorControls";
import {
  isJsonContainer,
  jsonPathKey,
  toolbarTextButtonClass,
} from "./textJsonEditorControlUtils";
import {
  cloneJsonValue,
  coerceJsonEditorValue,
  deleteJsonPathValue,
  firstJsonChildPathSegment,
  getJsonPathValue,
  insertJsonObjectEntry,
  jsonEditorValueType,
  jsonPathExists,
  jsonPathLabel,
  parentJsonPath,
  setJsonPathValue,
  sortJsonValue,
} from "./textJsonUtils";
import type { JsonPathSegment } from "./textJsonUtils";
export { JsonPreview } from "./jsonPreview";
export { JsonTableEditor } from "./jsonTableEditor";

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
