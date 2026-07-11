import type { DragEvent as ReactDragEvent } from "react";
import { GripVertical, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { JsonPathSegment } from "./textJsonUtils";

export function JsonDeleteButton({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-35"
      title="Delete"
    >
      <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

export function JsonDragHandle({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={(event) => event.stopPropagation()}
      className="inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:cursor-grabbing"
      title={label}
      aria-label={label}
    >
      <GripVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

export function JsonBreadcrumb({
  path,
  onSelect,
}: {
  path: JsonPathSegment[];
  onSelect: (path: JsonPathSegment[]) => void;
}) {
  const segments: Array<{ label: string; path: JsonPathSegment[] }> = [
    { label: "root", path: [] },
  ];
  path.forEach((segment, index) => {
    segments.push({
      label: typeof segment === "number" ? `[${segment}]` : segment,
      path: path.slice(0, index + 1),
    });
  });
  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
      {segments.map((segment, index) => (
        <button
          key={`${index}:${segment.label}`}
          type="button"
          onClick={() => onSelect(segment.path)}
          className="rounded-md px-1.5 py-1 font-mono text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {index > 0 ? "/" : ""}
          {segment.label}
        </button>
      ))}
    </nav>
  );
}

export function JsonIconButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-35"
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
