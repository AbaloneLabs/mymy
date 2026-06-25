import type { KnowledgeTreeNode } from "@/types/knowledge";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

export function flattenTree(
  nodes: KnowledgeTreeNode[],
  depth = 0,
): { id: string; title: string; depth: number }[] {
  const out: { id: string; title: string; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, title: node.title, depth });
    if (node.children.length > 0) {
      out.push(...flattenTree(node.children, depth + 1));
    }
  }
  return out;
}

export function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function extractHeadings(content: string): TocItem[] {
  const lines = content.split("\n");
  const items: TocItem[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      items.push({ id: slugifyHeading(text), text, level });
    }
  }
  return items;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export function scrollToHeading(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}
