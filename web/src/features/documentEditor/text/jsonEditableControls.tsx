import { ArrowDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { JsonDeleteButton } from "./textJsonEditorControls";
import {
  jsonPathLabel,
  jsonPathsEqual,
  jsonPrimitiveClass,
} from "./textJsonUtils";
import type { JsonPathSegment } from "./textJsonUtils";

export function JsonContainerHeader({
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

export function JsonPrimitiveEditor({
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
