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

export interface SourceSelectionRange {
  start: number;
  end: number;
}

export interface SourceSelectionLineFragment {
  line: number;
  startColumn: number;
  endColumn: number;
  caret: boolean;
}

export interface SourceBracketPairFragment {
  line: number;
  column: number;
  level: number;
  matched: boolean;
}

export interface SourceMultiCursorEdit {
  content: string;
  ranges: SourceSelectionRange[];
  primaryRange: SourceSelectionRange;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
}

export interface ChunkedSourcePasteOptions {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  pastedText: string;
  chunkSize?: number;
  onChunk: (edit: SourceEdit, progress: SourceAsyncProgress) => void;
  onDone?: (edit: SourceEdit) => void;
}

export interface SourceAsyncProgress {
  processed: number;
  total: number;
}

export interface ChunkedSearchCountOptions extends SearchOptions {
  content: string;
  query: string;
  chunkSize?: number;
  onProgress?: (progress: SourceAsyncProgress & { count: number }) => void;
  onDone: (count: number) => void;
}

export interface ChunkedSearchRangeOptions extends SearchOptions {
  content: string;
  query: string;
  start: number;
  chunkSize?: number;
  onProgress?: (progress: SourceAsyncProgress) => void;
  onDone: (range: SourceSelectionRange | null) => void;
}

export interface SourceOutlineItem {
  line: number;
  kind: string;
  label: string;
}

export interface SourceFoldRange {
  id: string;
  startLine: number;
  endLine: number;
  label: string;
}

export interface SourceVisibleLine {
  line: number;
  text: string;
  foldId?: string;
  hiddenLineCount?: number;
}

export interface SourceMinimapLine {
  line: number;
  text: string;
}

export type SourceBracketMatch =
  | {
      matched: true;
      open: SourceBracketPosition;
      close: SourceBracketPosition;
    }
  | {
      matched: false;
      focus: SourceBracketPosition;
    };

interface SourceBracketPosition {
  char: string;
  line: number;
  column: number;
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

export function normalizeSourceSelectionRanges(
  ranges: SourceSelectionRange[],
): SourceSelectionRange[] {
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, range.end)),
      end: Math.max(0, Math.max(range.start, range.end)),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const output: SourceSelectionRange[] = [];
  normalized.forEach((range) => {
    const previous = output.at(-1);
    if (!previous) {
      output.push(range);
      return;
    }
    if (range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return;
    }
    if (range.start === previous.start && range.end === previous.end) return;
    output.push(range);
  });
  return output;
}

export function sourceNextOccurrenceRanges(
  content: string,
  ranges: SourceSelectionRange[],
  selectionStart: number,
  selectionEnd: number,
): SourceSelectionRange[] {
  const currentRanges = normalizeSourceSelectionRanges(
    ranges.length > 0 ? ranges : [{ start: selectionStart, end: selectionEnd }],
  );
  const firstRange = currentRanges[0];
  const queryRange =
    firstRange && firstRange.start !== firstRange.end
      ? firstRange
      : sourceWordRangeAtOffset(content, selectionStart);
  if (!queryRange || queryRange.start === queryRange.end) return currentRanges;
  const query = content.slice(queryRange.start, queryRange.end);
  if (!query) return currentRanges;
  if (currentRanges.length === 1 && firstRange?.start === firstRange.end) {
    return [queryRange];
  }
  const after = currentRanges.at(-1)?.end ?? queryRange.end;
  const nextIndex = nextPlainTextOccurrence(content, query, after, currentRanges);
  if (nextIndex === null) return currentRanges;
  return normalizeSourceSelectionRanges([
    ...currentRanges,
    { start: nextIndex, end: nextIndex + query.length },
  ]);
}

export function rectangularSourceSelectionRanges(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): SourceSelectionRange[] {
  if (selectionStart === selectionEnd) return [];
  const start = textOffsetPosition(content, selectionStart);
  const end = textOffsetPosition(content, selectionEnd);
  const topLine = Math.min(start.line, end.line);
  const bottomLine = Math.max(start.line, end.line);
  const leftColumn = Math.min(start.column, end.column);
  const rightColumn = Math.max(start.column, end.column);
  if (topLine === bottomLine) {
    return normalizeSourceSelectionRanges([{ start: selectionStart, end: selectionEnd }]);
  }
  const lineOffsets = textLineOffsets(content);
  return normalizeSourceSelectionRanges(
    Array.from({ length: bottomLine - topLine + 1 }, (_, offset) => {
      const line = topLine + offset;
      const lineStart = lineOffsets[line - 1] ?? content.length;
      const lineEnd = lineOffsets[line] !== undefined
        ? Math.max(lineStart, (lineOffsets[line] ?? lineStart) - 1)
        : content.length;
      const lineLength = Math.max(0, lineEnd - lineStart);
      const startColumn = Math.min(leftColumn, lineLength);
      const endColumn = Math.min(rightColumn, lineLength);
      return {
        start: lineStart + startColumn,
        end: lineStart + endColumn,
      };
    }),
  );
}

export function applySourceSelectionTextEdit(
  content: string,
  ranges: SourceSelectionRange[],
  text: string,
): SourceMultiCursorEdit | null {
  const normalized = normalizeSourceSelectionRanges(ranges);
  if (normalized.length === 0) return null;
  let nextContent = "";
  let cursor = 0;
  const nextRanges: SourceSelectionRange[] = [];
  normalized.forEach((range) => {
    nextContent += content.slice(cursor, range.start);
    const nextStart = nextContent.length;
    nextContent += text;
    nextRanges.push({ start: nextStart, end: nextStart + text.length });
    cursor = range.end;
  });
  nextContent += content.slice(cursor);
  return {
    content: nextContent,
    ranges: nextRanges,
    primaryRange: nextRanges.at(-1) ?? { start: nextContent.length, end: nextContent.length },
  };
}

export function applySourceSelectionDelete(
  content: string,
  ranges: SourceSelectionRange[],
  direction: "backward" | "forward",
): SourceMultiCursorEdit | null {
  const normalized = normalizeSourceSelectionRanges(ranges);
  if (normalized.length === 0) return null;
  const deleteRanges = normalizeSourceSelectionRanges(
    normalized.map((range) => {
      if (range.start !== range.end) return range;
      if (direction === "backward") {
        return { start: Math.max(0, range.start - 1), end: range.start };
      }
      return { start: range.start, end: Math.min(content.length, range.end + 1) };
    }),
  ).filter((range) => range.start !== range.end);
  if (deleteRanges.length === 0) return null;
  let nextContent = "";
  let cursor = 0;
  const nextRanges: SourceSelectionRange[] = [];
  deleteRanges.forEach((range) => {
    nextContent += content.slice(cursor, range.start);
    nextRanges.push({ start: nextContent.length, end: nextContent.length });
    cursor = range.end;
  });
  nextContent += content.slice(cursor);
  return {
    content: nextContent,
    ranges: nextRanges,
    primaryRange: nextRanges.at(-1) ?? { start: nextContent.length, end: nextContent.length },
  };
}

export function sourceSelectionLineFragments(
  content: string,
  ranges: SourceSelectionRange[],
): SourceSelectionLineFragment[] {
  const normalized = normalizeSourceSelectionRanges(ranges);
  const fragments: SourceSelectionLineFragment[] = [];
  normalized.forEach((range) => {
    const start = textOffsetPosition(content, range.start);
    const end = textOffsetPosition(content, range.end);
    for (let line = start.line; line <= end.line; line += 1) {
      const lineStartColumn = line === start.line ? start.column : 0;
      const lineEndColumn = line === end.line ? end.column : textLineLength(content, line);
      fragments.push({
        line,
        startColumn: Math.min(lineStartColumn, lineEndColumn),
        endColumn: Math.max(lineStartColumn, lineEndColumn),
        caret: range.start === range.end,
      });
    }
  });
  return fragments;
}

export function startChunkedSourcePaste({
  content,
  selectionStart,
  selectionEnd,
  pastedText,
  chunkSize = 64 * 1024,
  onChunk,
  onDone,
}: ChunkedSourcePasteOptions) {
  let cancelled = false;
  let processed = 0;
  let inserted = "";
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(0, Math.max(selectionStart, selectionEnd));
  const prefix = content.slice(0, start);
  const suffix = content.slice(end);

  function step() {
    if (cancelled) return;
    const next = pastedText.slice(processed, processed + chunkSize);
    processed += next.length;
    inserted += next;
    const edit = {
      content: `${prefix}${inserted}${suffix}`,
      selectionStart: start + inserted.length,
      selectionEnd: start + inserted.length,
    };
    const progress = { processed, total: pastedText.length };
    onChunk(edit, progress);
    if (processed < pastedText.length) {
      scheduleSourceTask(step);
      return;
    }
    onDone?.(edit);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

export function startChunkedSearchCount({
  content,
  query,
  caseSensitive,
  wholeWord,
  regexSearch,
  chunkSize = 256 * 1024,
  onProgress,
  onDone,
}: ChunkedSearchCountOptions) {
  const regex = buildSearchRegex(query, { caseSensitive, wholeWord, regexSearch });
  if (!regex) {
    onDone(0);
    return () => undefined;
  }
  const searchRegex = regex;
  let cancelled = false;
  let offset = 0;
  let count = 0;
  const overlap = Math.max(256, regexSearch ? 1024 : query.length + 8);

  function step() {
    if (cancelled) return;
    const chunkStart = Math.max(0, offset - overlap);
    const chunkEnd = Math.min(content.length, offset + chunkSize);
    const chunk = content.slice(chunkStart, chunkEnd);
    const minimumAbsoluteStart = offset;
    searchRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(chunk))) {
      if (match[0].length === 0) break;
      const absoluteStart = chunkStart + match.index;
      if (absoluteStart >= minimumAbsoluteStart) count += 1;
    }
    offset = chunkEnd;
    onProgress?.({ processed: offset, total: content.length, count });
    if (offset < content.length) {
      scheduleSourceTask(step);
      return;
    }
    onDone(count);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

export function startChunkedSearchRange({
  content,
  query,
  caseSensitive,
  wholeWord,
  regexSearch,
  start,
  chunkSize = 256 * 1024,
  onProgress,
  onDone,
}: ChunkedSearchRangeOptions) {
  const regex = buildSearchRegex(query, { caseSensitive, wholeWord, regexSearch });
  if (!regex) {
    onDone(null);
    return () => undefined;
  }
  const searchRegex = regex;
  const overlap = Math.max(256, regexSearch ? 1024 : query.length + 8);
  const firstStart = Math.max(0, Math.min(content.length, start));
  let cancelled = false;
  let offset = firstStart;
  let wrapped = false;

  function step() {
    if (cancelled) return;
    const limit = wrapped ? firstStart : content.length;
    if (offset >= limit) {
      if (!wrapped && firstStart > 0) {
        wrapped = true;
        offset = 0;
        scheduleSourceTask(step);
        return;
      }
      onDone(null);
      return;
    }

    const acceptedEnd = Math.min(limit, offset + chunkSize);
    const chunkEnd = Math.min(content.length, acceptedEnd + overlap);
    const chunk = content.slice(offset, chunkEnd);
    searchRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(chunk))) {
      if (match[0].length === 0) break;
      const absoluteStart = offset + match.index;
      if (absoluteStart >= offset && absoluteStart < acceptedEnd) {
        onDone({
          start: absoluteStart,
          end: absoluteStart + match[0].length,
        });
        return;
      }
    }

    offset = acceptedEnd;
    onProgress?.({
      processed: wrapped ? firstStart + offset : offset - firstStart,
      total: content.length,
    });
    scheduleSourceTask(step);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

export function sourceBracketPairFragments(
  content: string,
  maxFragments = 5_000,
): SourceBracketPairFragment[] {
  const fragments: SourceBracketPairFragment[] = [];
  const stack: Array<{ char: string; fragmentIndex: number; level: number }> = [];
  let line = 1;
  let column = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\n") {
      line += 1;
      column = 0;
      continue;
    }
    if (SOURCE_OPEN_BRACKETS.includes(char)) {
      if (fragments.length >= maxFragments) break;
      const level = stack.length;
      fragments.push({ line, column, level, matched: false });
      stack.push({ char, fragmentIndex: fragments.length - 1, level });
    } else if (SOURCE_CLOSE_BRACKETS.includes(char)) {
      if (fragments.length >= maxFragments) break;
      const open = SOURCE_REVERSE_BRACKET_PAIRS[char];
      const previous = stack.at(-1);
      if (previous?.char === open) {
        fragments[previous.fragmentIndex] = {
          ...fragments[previous.fragmentIndex],
          matched: true,
        };
        fragments.push({
          line,
          column,
          level: previous.level,
          matched: true,
        });
        stack.pop();
      } else {
        fragments.push({ line, column, level: 0, matched: false });
      }
    }
    column += 1;
  }
  return fragments;
}

export function sourceDisplayText(lines: SourceVisibleLine[]) {
  return lines
    .map((line) => {
      if (!line.hiddenLineCount) return line.text;
      const suffix = `  ... ${line.hiddenLineCount} folded lines`;
      return line.text.trim() ? `${line.text}${suffix}` : suffix.trimStart();
    })
    .join("\n");
}

export function activeSourceFoldIds(
  ids: ReadonlySet<string>,
  ranges: SourceFoldRange[],
) {
  if (ids.size === 0) return ids;
  const validIds = new Set(ranges.map((range) => range.id));
  return new Set(Array.from(ids).filter((id) => validIds.has(id)));
}

export function sourceMinimapLines(content: string): SourceMinimapLine[] {
  const lines = content.split("\n");
  const maxLines = 220;
  if (lines.length <= maxLines) {
    return lines.map((text, index) => ({ text, line: index + 1 }));
  }
  const step = Math.ceil(lines.length / maxLines);
  return lines
    .map((text, index) => ({ text, line: index + 1 }))
    .filter((_, index) => index % step === 0)
    .slice(0, maxLines);
}

export function isPotentialSourceEditKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
) {
  if (event.key.length === 1) return true;
  return ["Backspace", "Delete", "Enter", "Tab"].includes(event.key);
}

export function sourceBracketMatch(
  content: string,
  offset: number,
): SourceBracketMatch | null {
  const bracket = sourceBracketAtCursor(content, offset);
  if (!bracket) return null;
  const matchOffset =
    bracket.direction === "forward"
      ? scanBracketForward(content, bracket.offset, bracket.char)
      : scanBracketBackward(content, bracket.offset, bracket.char);
  const focus = sourceBracketPosition(content, bracket.offset, bracket.char);
  if (matchOffset === null) {
    return { matched: false, focus };
  }
  const matchChar = content[matchOffset] ?? "";
  const match = sourceBracketPosition(content, matchOffset, matchChar);
  return bracket.direction === "forward"
    ? { matched: true, open: focus, close: match }
    : { matched: true, open: match, close: focus };
}

function sourceBracketAtCursor(content: string, offset: number) {
  const candidates = [offset - 1, offset].filter(
    (index) => index >= 0 && index < content.length,
  );
  for (const candidate of candidates) {
    const char = content[candidate];
    if (SOURCE_OPEN_BRACKETS.includes(char)) {
      return { offset: candidate, char, direction: "forward" as const };
    }
    if (SOURCE_CLOSE_BRACKETS.includes(char)) {
      return { offset: candidate, char, direction: "backward" as const };
    }
  }
  return null;
}

function scanBracketForward(content: string, start: number, open: string) {
  const close = SOURCE_BRACKET_PAIRS[open];
  if (!close) return null;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function scanBracketBackward(content: string, start: number, close: string) {
  const open = SOURCE_REVERSE_BRACKET_PAIRS[close];
  if (!open) return null;
  let depth = 0;
  for (let index = start; index >= 0; index -= 1) {
    const char = content[index];
    if (char === close) depth += 1;
    if (char === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function sourceBracketPosition(
  content: string,
  offset: number,
  char: string,
): SourceBracketPosition {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return {
    char,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
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

function sourceWordRangeAtOffset(content: string, offset: number): SourceSelectionRange | null {
  if (!content) return null;
  const startOffset = Math.max(0, Math.min(offset, content.length - 1));
  const fallbackOffset =
    isSourceWordChar(content[startOffset]) ? startOffset : Math.max(0, startOffset - 1);
  if (!isSourceWordChar(content[fallbackOffset])) return null;
  let start = fallbackOffset;
  let end = fallbackOffset + 1;
  while (start > 0 && isSourceWordChar(content[start - 1])) start -= 1;
  while (end < content.length && isSourceWordChar(content[end])) end += 1;
  return { start, end };
}

function nextPlainTextOccurrence(
  content: string,
  query: string,
  start: number,
  existingRanges: SourceSelectionRange[],
) {
  const occupied = new Set(existingRanges.map((range) => `${range.start}:${range.end}`));
  const searchStarts = [Math.max(0, start), 0];
  for (const searchStart of searchStarts) {
    let index = content.indexOf(query, searchStart);
    while (index >= 0) {
      const key = `${index}:${index + query.length}`;
      if (!occupied.has(key)) return index;
      index = content.indexOf(query, index + Math.max(1, query.length));
    }
  }
  return null;
}

function isSourceWordChar(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_$-]/.test(char));
}

function textLineOffsets(content: string) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function textOffsetPosition(content: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: clamped - lineStart };
}

function textLineLength(content: string, line: number) {
  const lineStart = offsetForTextLine(content, line);
  const nextLineStart = offsetForTextLine(content, line + 1);
  const lineEnd =
    nextLineStart > lineStart && content[nextLineStart - 1] === "\n"
      ? nextLineStart - 1
      : nextLineStart;
  return Math.max(0, lineEnd - lineStart);
}

function scheduleSourceTask(callback: () => void) {
  const browserWindow =
    typeof window === "undefined"
      ? null
      : (window as Window & {
          requestIdleCallback?: (
            callback: () => void,
            options?: { timeout: number },
          ) => number;
          requestAnimationFrame?: (callback: () => void) => number;
        });
  if (browserWindow?.requestIdleCallback) {
    const requestIdleCallback = browserWindow.requestIdleCallback as (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    requestIdleCallback(callback, { timeout: 80 });
    return;
  }
  if (browserWindow?.requestAnimationFrame) {
    browserWindow.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

const SOURCE_BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};
const SOURCE_REVERSE_BRACKET_PAIRS = Object.fromEntries(
  Object.entries(SOURCE_BRACKET_PAIRS).map(([open, close]) => [close, open]),
) as Record<string, string>;
const SOURCE_OPEN_BRACKETS = Object.keys(SOURCE_BRACKET_PAIRS);
const SOURCE_CLOSE_BRACKETS = Object.keys(SOURCE_REVERSE_BRACKET_PAIRS);

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
