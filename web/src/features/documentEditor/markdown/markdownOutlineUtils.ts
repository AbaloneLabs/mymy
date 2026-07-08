import type { MarkdownHeading, MarkdownHeadingAnchor } from "./markdownTypes";
import {
  escapeMarkdownLinkLabel,
  lineForOffset,
  markdownHeadingSlug,
  stripInlineMarkdown,
} from "./markdownTextUtils";

const MARKDOWN_TOC_START = "<!-- mymy-toc:start -->";
const MARKDOWN_TOC_END = "<!-- mymy-toc:end -->";

export function markdownOutline(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFence = false;
  content.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    headings.push({
      line: index + 1,
      level: match[1].length,
      text: stripInlineMarkdown(match[2]),
    });
  });
  return headings;
}

export function markdownHeadingAnchors(headings: MarkdownHeading[]) {
  const totals = new Map<string, number>();
  headings.forEach((heading) => {
    const base = markdownHeadingSlug(heading.text) || `heading-${heading.line}`;
    totals.set(base, (totals.get(base) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  return headings.map((heading): MarkdownHeadingAnchor => {
    const base = markdownHeadingSlug(heading.text) || `heading-${heading.line}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      line: heading.line,
      id: count === 0 ? base : `${base}-${count + 1}`,
      baseId: base,
      duplicateIndex: count + 1,
      duplicateCount: totals.get(base) ?? 1,
    };
  });
}

export function insertOrUpdateMarkdownToc(content: string, insertOffset: number) {
  const toc = buildMarkdownTableOfContents(content);
  if (!toc) return null;
  const existing = markdownTocRange(content);
  if (existing) {
    return {
      content: `${content.slice(0, existing.start)}${toc}${content.slice(existing.end)}`,
      selectionStart: existing.start,
      selectionEnd: existing.start + toc.length,
    };
  }
  const offset = Math.max(0, Math.min(content.length, insertOffset));
  const prefix = offset > 0 && !content.slice(0, offset).endsWith("\n") ? "\n\n" : "";
  const suffix = content.slice(offset).startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${prefix}${toc}${suffix}`;
  return {
    content: `${content.slice(0, offset)}${inserted}${content.slice(offset)}`,
    selectionStart: offset + prefix.length,
    selectionEnd: offset + prefix.length + toc.length,
  };
}

function buildMarkdownTableOfContents(content: string) {
  const existing = markdownTocRange(content);
  const headings = markdownOutline(content).filter((heading) => {
    if (existing && heading.line >= existing.startLine && heading.line <= existing.endLine) {
      return false;
    }
    return heading.text.trim().toLowerCase() !== "table of contents";
  });
  if (headings.length === 0) return null;
  const anchors = markdownHeadingAnchors(headings);
  const anchorByLine = new Map(anchors.map((anchor) => [anchor.line, anchor.id]));
  const minLevel = Math.min(...headings.map((heading) => heading.level));
  const lines = headings.map((heading) => {
    const depth = Math.max(0, heading.level - minLevel);
    const indent = "  ".repeat(depth);
    return `${indent}- [${escapeMarkdownLinkLabel(heading.text)}](#${anchorByLine.get(heading.line)})`;
  });
  return [MARKDOWN_TOC_START, ...lines, MARKDOWN_TOC_END].join("\n");
}

function markdownTocRange(content: string) {
  const start = content.indexOf(MARKDOWN_TOC_START);
  if (start === -1) return null;
  const endMarkerStart = content.indexOf(MARKDOWN_TOC_END, start);
  if (endMarkerStart === -1) return null;
  const end = endMarkerStart + MARKDOWN_TOC_END.length;
  return {
    start,
    end,
    startLine: lineForOffset(content, start),
    endLine: lineForOffset(content, end),
  };
}
