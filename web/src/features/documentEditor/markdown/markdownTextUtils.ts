import { parseFrontmatter } from "./markdownFrontmatter";
import type { MarkdownHeadingLevel } from "./markdownTypes";
import { advanceZeroWidthRegex } from "../text/textSearchSemantics";

export function stripInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]/g, "")
    .trim();
}

export function markdownHeadingSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function markdownStats(content: string, headings: number) {
  const lines = Math.max(1, content.split("\n").length);
  const words = stripInlineMarkdown(stripFrontmatter(content))
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    lines,
    words,
    characters: content.length,
    headings,
  };
}

function stripFrontmatter(content: string) {
  const frontmatter = parseFrontmatter(content);
  return frontmatter ? content.slice(frontmatter.end) : content;
}

export function indentMarkdownLine(line: string) {
  return `  ${line}`;
}

export function outdentMarkdownLine(line: string) {
  return line.replace(/^( {1,2}|\t)/, "");
}

export function offsetForLine(content: string, line: number) {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = content.indexOf("\n", offset);
    if (next === -1) return content.length;
    offset = next + 1;
  }
  return offset;
}

export function lineForOffset(content: string, offset: number) {
  return content.slice(0, offset).split("\n").length;
}

export function nextMarkdownFootnoteId(content: string) {
  const existing = new Set<string>();
  const pattern = /\[\^([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) existing.add(match[1]);
  let index = 1;
  while (existing.has(`note${index}`)) index += 1;
  return `note${index}`;
}

export function insertFootnoteReference(
  content: string,
  id: string,
  start: number,
  end: number,
) {
  const reference = `[^${id}]`;
  const withReference = `${content.slice(0, start)}${reference}${content.slice(end)}`;
  const next = appendFootnoteDefinition(withReference, id);
  return {
    content: next,
    selectionStart: start + reference.length,
    selectionEnd: start + reference.length,
  };
}

function appendFootnoteDefinition(content: string, id: string) {
  const definitionPattern = new RegExp(`^\\[\\^${escapeRegExp(id)}\\]:`, "m");
  if (definitionPattern.test(content)) return content;
  const separator = content.endsWith("\n\n")
    ? ""
    : content.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${content}${separator}[^${id}]: Footnote\n`;
}

export function isMarkdownUrl(value: string) {
  return /^(https?:\/\/|mailto:|\/drive\/|\.{0,2}\/|#)/i.test(value);
}

export function hasTrailingTextNewline(content: string) {
  return content.endsWith("\n") || content.endsWith("\r");
}

export function isMarkdownHeadingKey(value: string): value is `${MarkdownHeadingLevel}` {
  return /^[1-6]$/.test(value);
}

export function buildMarkdownSearchRegex(
  query: string,
  options: { matchCase: boolean; wholeWord?: boolean; regexSearch?: boolean },
) {
  if (!query) return null;
  const source = options.regexSearch ? query : escapeRegExp(query);
  const wrapped = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
    : source;
  try {
    return new RegExp(wrapped, options.matchCase ? "gu" : "giu");
  } catch {
    return null;
  }
}

export function countMarkdownSearchMatches(
  content: string,
  query: string,
  options: { matchCase: boolean; wholeWord?: boolean; regexSearch?: boolean },
) {
  const regex = buildMarkdownSearchRegex(query, options);
  if (!regex) return 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    count += 1;
    if (match[0].length === 0 && !advanceZeroWidthRegex(regex, content)) break;
  }
  return count;
}

export function nextMarkdownSearchRange(
  content: string,
  query: string,
  options: {
    matchCase: boolean;
    wholeWord?: boolean;
    regexSearch?: boolean;
    start: number;
  },
) {
  const regex = buildMarkdownSearchRegex(query, options);
  if (!regex) return null;
  regex.lastIndex = options.start;
  let match = regex.exec(content);
  if (!match) {
    regex.lastIndex = 0;
    match = regex.exec(content);
  }
  if (!match) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}
