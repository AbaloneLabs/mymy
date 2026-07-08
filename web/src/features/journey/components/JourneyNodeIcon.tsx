import { Boxes, Puzzle } from "lucide-react";
import type { JourneyNode } from "@/features/journey/api";

export function JourneyNodeIcon({ node }: { node: JourneyNode }) {
  const Icon = node.type === "skill" ? Puzzle : Boxes;
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-hover)] text-[var(--text-muted)]">
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </span>
  );
}
