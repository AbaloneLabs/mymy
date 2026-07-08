import { selectedLineRange } from "./textSourceLineEditing";
import type { SourceEdit, TextEditorKind } from "./textSourceTypes";

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
