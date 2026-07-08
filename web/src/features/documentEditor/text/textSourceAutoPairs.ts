import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SourceEdit, TextEditorKind } from "./textSourceTypes";

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

export function isPotentialSourceEditKey(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
) {
  if (event.key.length === 1) return true;
  return ["Backspace", "Delete", "Enter", "Tab"].includes(event.key);
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
