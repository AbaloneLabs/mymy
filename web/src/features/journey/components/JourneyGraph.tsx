import { Boxes, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JourneyEdge, JourneyNode } from "@/features/journey/api";
import { graphPositions } from "./journeyViewUtils";

export function JourneyGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = nodes.slice(0, 80);
  const positions = graphPositions(visible);
  return (
    <div className="relative h-72 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <svg className="absolute inset-0 h-full w-full">
        {edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.source}:${edge.target}`}
              x1={`${source.x}%`}
              y1={`${source.y}%`}
              x2={`${target.x}%`}
              y2={`${target.y}%`}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          );
        })}
      </svg>
      {visible.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const Icon = node.type === "skill" ? Puzzle : Boxes;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className={cn(
              "absolute flex max-w-36 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] shadow-sm",
              selectedId === node.id
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]",
            )}
          >
            <Icon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{node.title}</span>
          </button>
        );
      })}
    </div>
  );
}
