import type {
  SearchOptions,
  SourceFoldRange,
  SourceOutlineItem,
  SourceVisibleLine,
} from "./textSourceTypes";
import { advanceZeroWidthRegex } from "./textSearchSemantics";

export function cursorPosition(content: string, start: number, end: number) {
  const before = content.slice(0, start);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
    selection: Math.abs(end - start),
  };
}

export function offsetForTextLine(content: string, line: number) {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = content.indexOf("\n", offset);
    if (next === -1) return content.length;
    offset = next + 1;
  }
  return offset;
}

export function textStats(content: string) {
  return {
    lines: countTextLines(content),
    characters: content.length,
  };
}

export function countTextLines(content: string) {
  if (!content) return 1;
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

export function lineEndingLabel(value: string | undefined) {
  if (value === "\r\n") return "CRLF";
  if (value === "\r") return "CR";
  return "LF";
}

export function lineEndingValue(value: string | undefined) {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}

export function hasTrailingTextNewline(content: string) {
  return content.endsWith("\n") || content.endsWith("\r");
}

export function sourceFoldRanges(content: string, language: string): SourceFoldRange[] {
  const lines = content.split("\n");
  const ranges =
    language === "markdown"
      ? markdownFoldRanges(lines)
      : indentFoldRanges(lines, language).concat(braceFoldRanges(lines));
  const unique = new Map<string, SourceFoldRange>();
  ranges
    .filter((range) => range.endLine > range.startLine)
    .sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine)
    .forEach((range) => {
      const key = `${range.startLine}:${range.endLine}`;
      if (!unique.has(key)) unique.set(key, range);
    });
  return Array.from(unique.values()).slice(0, 1_000);
}

export function sourceVisibleLines(
  content: string,
  foldRanges: SourceFoldRange[],
  foldedIds: ReadonlySet<string>,
): SourceVisibleLine[] {
  const lines = content.split("\n");
  const rangeByStart = new Map<number, SourceFoldRange>();
  foldRanges.forEach((range) => {
    if (foldedIds.has(range.id)) rangeByStart.set(range.startLine, range);
  });
  const visible: SourceVisibleLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const folded = rangeByStart.get(line);
    visible.push({
      line,
      text: lines[index],
      foldId: folded?.id,
      hiddenLineCount: folded ? folded.endLine - folded.startLine : undefined,
    });
    if (folded) index = Math.min(lines.length - 1, folded.endLine - 1);
  }
  return visible.length > 0 ? visible : [{ line: 1, text: "" }];
}

export function textSourceOutline(content: string, language: string): SourceOutlineItem[] {
  const items: SourceOutlineItem[] = [];
  content.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const item =
      outlineJavaScriptLike(trimmed, language) ??
      outlinePython(trimmed, language) ??
      outlineRust(trimmed, language) ??
      outlineShell(trimmed, language) ??
      outlineSql(trimmed, language) ??
      outlineCss(trimmed, language) ??
      outlineXmlLike(trimmed, language) ??
      outlineStructuredText(trimmed, language);
    if (item) items.push({ ...item, line: lineNumber });
  });
  return items.slice(0, 500);
}

function outlineJavaScriptLike(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (!["javascript", "typescript", "jsx", "tsx"].includes(language)) return null;
  const declaration =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/.exec(line) ??
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (!declaration) return null;
  return { kind: "symbol", label: declaration[1] };
}

function outlinePython(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "python") return null;
  const match = /^(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/.exec(line);
  return match ? { kind: match[1], label: match[2] } : null;
}

function outlineRust(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "rs") return null;
  const match = /^(?:pub(?:\([^)]*\))?\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_][\w]*)?/.exec(line);
  if (!match) return null;
  return { kind: match[1], label: match[2] ?? line.replace(/\s*\{.*$/, "") };
}

function outlineShell(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "bash" && language !== "shellscript") return null;
  const match = /^(?:function\s+)?([A-Za-z_][\w-]*)\s*(?:\(\))?\s*\{/.exec(line);
  return match ? { kind: "function", label: match[1] } : null;
}

function outlineSql(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "sql") return null;
  const match = /^create\s+(table|view|function|procedure|index)\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."`]+)/i.exec(line);
  return match ? { kind: match[1].toLowerCase(), label: match[2] } : null;
}

function outlineCss(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "css") return null;
  if (!line.endsWith("{")) return null;
  return { kind: "selector", label: line.slice(0, -1).trim() };
}

function outlineXmlLike(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language !== "xml" && language !== "html") return null;
  const heading = /^<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1>/i.exec(line);
  if (heading) return { kind: `h${heading[1]}`, label: heading[2].replace(/<[^>]+>/g, "") };
  const id = /^<([A-Za-z][\w:-]*)(?:\s[^>]*\sid=["']([^"']+)["'][^>]*)?>/.exec(line);
  if (!id) return null;
  return { kind: id[1], label: id[2] ?? id[1] };
}

function outlineStructuredText(
  line: string,
  language: string,
): Omit<SourceOutlineItem, "line"> | null {
  if (language === "json") {
    const match = /^"([^"]+)"\s*:/.exec(line);
    return match ? { kind: "key", label: match[1] } : null;
  }
  if (language === "yaml") {
    const match = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
    return match ? { kind: "key", label: match[1] } : null;
  }
  if (language === "toml") {
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) return { kind: "section", label: section[1] };
    const key = /^([A-Za-z0-9_.-]+)\s*=/.exec(line);
    return key ? { kind: "key", label: key[1] } : null;
  }
  return null;
}

export function buildSearchRegex(query: string, options: SearchOptions) {
  if (!query) return null;
  const source = options.regexSearch ? query : escapeRegExp(query);
  const wrapped = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
    : source;
  try {
    return new RegExp(wrapped, options.caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

export function countSearchMatches(content: string, query: string, options: SearchOptions) {
  const regex = buildSearchRegex(query, options);
  if (!regex) return 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    count += 1;
    if (match[0].length === 0 && !advanceZeroWidthRegex(regex, content)) break;
  }
  return count;
}

export function nextSearchRange(
  content: string,
  query: string,
  options: SearchOptions & { start: number },
) {
  const regex = buildSearchRegex(query, options);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownFoldRanges(lines: string[]): SourceFoldRange[] {
  const headings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      return {
        line: index + 1,
        level: match[1].length,
        label: match[2].replace(/\s+#+$/, "").trim(),
      };
    })
    .filter((heading): heading is { line: number; level: number; label: string } =>
      Boolean(heading),
    );
  return headings
    .map((heading, index): SourceFoldRange | null => {
      const nextPeer = headings
        .slice(index + 1)
        .find((candidate) => candidate.level <= heading.level);
      const endLine = (nextPeer?.line ?? lines.length + 1) - 1;
      if (endLine <= heading.line) return null;
      return {
        id: `md:${heading.line}:${endLine}`,
        startLine: heading.line,
        endLine,
        label: heading.label || `Heading ${heading.level}`,
      };
    })
    .filter((range): range is SourceFoldRange => Boolean(range));
}

function indentFoldRanges(lines: string[], language: string): SourceFoldRange[] {
  if (!["python", "yaml", "bash", "shellscript"].includes(language)) return [];
  const ranges: SourceFoldRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || isCommentOnlyLine(trimmed, language)) continue;
    const indent = leadingWhitespaceWidth(line);
    let end = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLine = lines[next];
      if (!nextLine.trim()) {
        end = next;
        continue;
      }
      if (leadingWhitespaceWidth(nextLine) <= indent) break;
      end = next;
    }
    if (end > index) {
      ranges.push({
        id: `indent:${index + 1}:${end + 1}`,
        startLine: index + 1,
        endLine: end + 1,
        label: trimmed.slice(0, 80),
      });
    }
  }
  return ranges;
}

function braceFoldRanges(lines: string[]): SourceFoldRange[] {
  const ranges: SourceFoldRange[] = [];
  const stack: Array<{ line: number; label: string; char: string }> = [];
  lines.forEach((line, index) => {
    const sanitized = stripQuotedText(line);
    for (const char of sanitized) {
      if (char === "{" || char === "[" || char === "(") {
        stack.push({ line: index + 1, label: line.trim().slice(0, 80), char });
      } else if (char === "}" || char === "]" || char === ")") {
        const open = matchingOpenBracket(char);
        const startIndex = findLastOpenBracket(stack, open);
        if (startIndex === -1) continue;
        const [start] = stack.splice(startIndex, 1);
        if (index + 1 > start.line) {
          ranges.push({
            id: `brace:${start.line}:${index + 1}`,
            startLine: start.line,
            endLine: index + 1,
            label: start.label || start.char,
          });
        }
      }
    }
  });
  return ranges;
}

function leadingWhitespaceWidth(line: string) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 2;
    else break;
  }
  return width;
}

function isCommentOnlyLine(trimmed: string, language: string) {
  if (language === "yaml" || language === "python" || language === "bash" || language === "shellscript") {
    return trimmed.startsWith("#");
  }
  return false;
}

function stripQuotedText(line: string) {
  let output = "";
  let quote: string | null = null;
  let escaped = false;
  for (const char of line) {
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      output += " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function matchingOpenBracket(close: string) {
  if (close === "}") return "{";
  if (close === "]") return "[";
  return "(";
}

function findLastOpenBracket(
  stack: Array<{ line: number; label: string; char: string }>,
  open: string,
) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].char === open) return index;
  }
  return -1;
}
