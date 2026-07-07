import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Source text editing behavior is shared by plain text, code, and structured
 * text modes. Keeping these operations outside the editor component makes the
 * UI responsible only for state and focus management, while edits, selections,
 * language detection, search, and outlines remain deterministic text
 * transformations.
 */
export type TextEditorKind = "json" | "yaml" | "toml" | "code" | "text";

export interface SourceEdit {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
}

export interface SourceOutlineItem {
  line: number;
  kind: string;
  label: string;
}

export function textEditorKind(filePath: string): TextEditorKind {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "toml") return "toml";
  if (
    [
      "css",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "rs",
      "py",
      "sh",
      "bash",
      "sql",
      "xml",
      "html",
      "htm",
    ].includes(extension)
  ) {
    return "code";
  }
  return "text";
}

export function languageForPath(filePath: string, kind: TextEditorKind) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "json") return "json";
  if (kind === "yaml") return "yaml";
  if (kind === "toml") return "toml";
  const aliases: Record<string, string> = {
    cjs: "javascript",
    htm: "html",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[extension] ?? (extension || "text");
}

export function selectedLineRange(content: string, start: number, end: number) {
  const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = content.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
  return { start: lineStart, end: lineEnd };
}

export function transformSelectedLines(
  content: string,
  start: number,
  end: number,
  transform: (line: string) => string,
): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const trailingNewline = block.endsWith("\n");
  const body = trailingNewline ? block.slice(0, -1) : block;
  const nextBody = body.split("\n").map(transform).join("\n");
  const nextBlock = trailingNewline ? `${nextBody}\n` : nextBody;
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.start,
    selectionEnd: range.start + nextBlock.length,
  };
}

export function indentTextLine(line: string) {
  return `  ${line}`;
}

export function outdentTextLine(line: string) {
  return line.replace(/^( {1,2}|\t)/, "");
}

export function lineCommentToken(filePath: string, kind: TextEditorKind) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "yaml" || kind === "toml") return "#";
  if (["py", "sh", "bash"].includes(extension)) return "#";
  if (extension === "sql") return "--";
  return "//";
}

export function blockCommentTokens(filePath: string, kind: TextEditorKind) {
  if (kind !== "code") return null;
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["html", "htm", "xml"].includes(extension)) {
    return { open: "<!--", close: "-->" };
  }
  if (["css", "js", "jsx", "mjs", "cjs", "ts", "tsx", "rs", "sql"].includes(extension)) {
    return { open: "/*", close: "*/" };
  }
  return null;
}

export function toggleCommentLine(line: string, token: string) {
  if (!line.trim()) return line;
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length);
  if (rest.startsWith(`${token} `)) return `${indent}${rest.slice(token.length + 1)}`;
  if (rest.startsWith(token)) return `${indent}${rest.slice(token.length)}`;
  return `${indent}${token} ${rest}`;
}

export function toggleBlockCommentRange(
  content: string,
  start: number,
  end: number,
  tokens: { open: string; close: string },
): SourceEdit {
  const range = start === end ? selectedLineContentRange(content, start) : { start, end };
  const selection = content.slice(range.start, range.end);
  const leading = /^\s*/.exec(selection)?.[0] ?? "";
  const trailing = /\s*$/.exec(selection)?.[0] ?? "";
  const innerStart = range.start + leading.length;
  const innerEnd = Math.max(innerStart, range.end - trailing.length);
  const inner = content.slice(innerStart, innerEnd);
  if (isBlockCommented(inner, tokens)) {
    const unwrapped = unwrapBlockComment(inner, tokens);
    return {
      content: `${content.slice(0, innerStart)}${unwrapped}${content.slice(innerEnd)}`,
      selectionStart: innerStart,
      selectionEnd: innerStart + unwrapped.length,
    };
  }
  const wrapped = wrapBlockComment(inner, tokens);
  const caretStart = inner.length === 0 ? innerStart + tokens.open.length + 1 : innerStart;
  const caretEnd = inner.length === 0 ? caretStart : innerStart + wrapped.length;
  return {
    content: `${content.slice(0, innerStart)}${wrapped}${content.slice(innerEnd)}`,
    selectionStart: caretStart,
    selectionEnd: caretEnd,
  };
}

function selectedLineContentRange(content: string, offset: number) {
  const range = selectedLineRange(content, offset, offset);
  const hasTrailingNewline = content.slice(range.start, range.end).endsWith("\n");
  return {
    start: range.start,
    end: hasTrailingNewline ? range.end - 1 : range.end,
  };
}

function isBlockCommented(inner: string, tokens: { open: string; close: string }) {
  return inner.startsWith(tokens.open) && inner.endsWith(tokens.close);
}

function unwrapBlockComment(inner: string, tokens: { open: string; close: string }) {
  let unwrapped = inner.slice(tokens.open.length, inner.length - tokens.close.length);
  if (unwrapped.startsWith("\n") && unwrapped.endsWith("\n")) {
    return unwrapped.slice(1, -1);
  }
  if (unwrapped.startsWith(" ")) unwrapped = unwrapped.slice(1);
  if (unwrapped.endsWith(" ")) unwrapped = unwrapped.slice(0, -1);
  return unwrapped;
}

function wrapBlockComment(inner: string, tokens: { open: string; close: string }) {
  if (!inner) return `${tokens.open} ${tokens.close}`;
  if (inner.includes("\n")) return `${tokens.open}\n${inner}\n${tokens.close}`;
  return `${tokens.open} ${inner} ${tokens.close}`;
}

export function autoPairSource(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  content: string,
  kind: TextEditorKind,
  applyEdit: (edit: SourceEdit | null) => void,
) {
  const nativeEvent = event.nativeEvent;
  if (kind === "text" || nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  const textarea = event.currentTarget;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end && isAutoPairClosingKey(event.key) && content[start] === event.key) {
    textarea.setSelectionRange(start + 1, start + 1);
    return true;
  }
  const close = autoPairClosingToken(event.key);
  if (!close) return false;
  const selected = content.slice(start, end);
  const inserted = `${event.key}${selected}${close}`;
  applyEdit({
    content: `${content.slice(0, start)}${inserted}${content.slice(end)}`,
    selectionStart: selected.length > 0 ? start + 1 : start + 1,
    selectionEnd: selected.length > 0 ? end + 1 : start + 1,
  });
  return true;
}

function autoPairClosingToken(key: string) {
  const pairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    "(": ")",
    "[": "]",
    "{": "}",
    "`": "`",
  };
  return pairs[key] ?? null;
}

function isAutoPairClosingKey(key: string) {
  return [")", "]", "}", '"', "'", "`"].includes(key);
}

export function duplicateSelectedLines(content: string, start: number, end: number): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const nextBlock = block.endsWith("\n") ? block : `${block}\n`;
  return {
    content: `${content.slice(0, range.end)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.end,
    selectionEnd: range.end + nextBlock.length,
  };
}

export function moveSelectedLines(
  content: string,
  start: number,
  end: number,
  direction: -1 | 1,
): SourceEdit | null {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  if (direction < 0) {
    if (range.start === 0) return null;
    const previousStart = content.lastIndexOf("\n", Math.max(0, range.start - 2)) + 1;
    const previousBlock = content.slice(previousStart, range.start);
    return {
      content: `${content.slice(0, previousStart)}${block}${previousBlock}${content.slice(range.end)}`,
      selectionStart: previousStart,
      selectionEnd: previousStart + block.length,
    };
  }
  if (range.end >= content.length) return null;
  const nextLineEndIndex = content.indexOf("\n", range.end);
  const nextEnd = nextLineEndIndex === -1 ? content.length : nextLineEndIndex + 1;
  const nextBlock = content.slice(range.end, nextEnd);
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${block}${content.slice(nextEnd)}`,
    selectionStart: range.start + nextBlock.length,
    selectionEnd: range.start + nextBlock.length + block.length,
  };
}

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
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, options.caseSensitive ? "g" : "gi");
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
    if (match[0].length === 0) break;
    count += 1;
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
  if (!match || match[0].length === 0) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
