import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRecord } from "../shared/models";
import {
  JsonDeleteButton,
  JsonDragHandle,
  JsonIconButton,
} from "./textJsonEditorControls";
import {
  JsonContainerHeader,
  JsonPrimitiveEditor,
} from "./jsonEditableControls";
import {
  jsonPathKey,
  startJsonDataDrag,
} from "./textJsonEditorControlUtils";
import {
  cloneJsonValue,
  jsonPathsEqual,
} from "./textJsonUtils";
import type { JsonPathSegment } from "./textJsonUtils";

export function JsonEditableValue({
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
