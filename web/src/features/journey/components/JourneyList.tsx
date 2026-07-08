import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JourneyNode } from "@/features/journey/api";
import { JourneyNodeIcon } from "./JourneyNodeIcon";

export function JourneyList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: JourneyNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => onSelect(node.id)}
          className={cn(
            "flex w-full items-start gap-3 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)]",
            selectedId === node.id && "bg-[var(--surface-hover)]",
          )}
        >
          <JourneyNodeIcon node={node} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--text)]">
                {node.title}
              </span>
              {node.pinned && (
                <Pin className="h-3 w-3 text-[var(--accent)]" strokeWidth={1.5} />
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
              {node.description || node.content || node.path}
            </span>
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            {node.state}
          </span>
        </button>
      ))}
    </div>
  );
}
