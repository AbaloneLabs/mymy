import type { JourneyNode } from "@/features/journey/api";

export function graphPositions(nodes: JourneyNode[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const count = Math.max(nodes.length, 1);
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / cols);
  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(node.id, {
      x: ((col + 1) / (cols + 1)) * 100,
      y: ((row + 1) / (rows + 1)) * 100,
    });
  });
  return positions;
}

export function formatJourneyDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
