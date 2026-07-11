import type { ConfigEntry } from "./textStructuredTypes";
import { parseFlatConfig } from "./textFlatConfigParsers";

/**
 * The flat editor owns scalar source spans, not the full YAML/TOML grammar.
 * Flow collections and reference-like values are therefore preserved as
 * source instead of being handed to the intentionally shallow inline parser.
 */
export function flatConfigEntryEditBlockReason(
  entry: ConfigEntry,
  kind: "yaml" | "toml",
) {
  const value = entry.value.trim();
  if (entry.valueStyle) {
    return "Multiline values are source-only so delimiters, indentation, and blank lines remain byte-exact";
  }
  if (kind === "yaml") {
    if (entry.key === "<<" || value.startsWith("*")) {
      return "YAML aliases and merge keys are source-only";
    }
    if (value.startsWith("[") || value.startsWith("{")) {
      return "YAML flow collections are source-only until nested parsing is lossless";
    }
  }
  if (
    kind === "toml" &&
    (value.startsWith("[") || value.startsWith("{"))
  ) {
    return "TOML arrays and inline tables are source-only until nested parsing is lossless";
  }
  if (kind === "toml" && entry.key.includes(".")) {
    return "TOML dotted keys are source-only because renaming can change table ownership";
  }
  if (
    kind === "toml" &&
    /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}|$)/.test(value)
  ) {
    return "TOML date/time values are source-only until typed serialization is lossless";
  }
  return null;
}

export function flatConfigStructuralEditBlockReason({
  unsupportedCount,
  documentCount = 1,
  content = "",
  entries,
  kind,
}: {
  unsupportedCount: number;
  documentCount?: number;
  content?: string;
  entries: ConfigEntry[];
  kind: "yaml" | "toml";
}) {
  if (documentCount > 1) {
    return "Multiple YAML documents make structural ownership ambiguous";
  }
  if (unsupportedCount > 0) {
    return `${unsupportedCount} source line(s) are outside the lossless grammar`;
  }
  if (entries.some((entry) => flatConfigEntryEditBlockReason(entry, kind))) {
    return "One or more values are preservation-only";
  }
  if (/(^|\n)\s*#|(^|[^\\])#/.test(content)) {
    return "Comments make structural trivia ownership ambiguous; scalar span edits remain available";
  }
  return null;
}

/**
 * A structured scalar edit is accepted only when the parser can rediscover the
 * same entry after patching. The replacement operates on exact key/value spans,
 * so comments, decorators, whitespace, and every other source byte remain
 * outside the mutation.
 */
export function patchLosslessFlatConfigScalar({
  content,
  entry,
  key,
  value,
  kind,
}: {
  content: string;
  entry: ConfigEntry;
  key: string;
  value: string;
  kind: "yaml" | "toml";
}) {
  if (flatConfigEntryEditBlockReason(entry, kind)) return null;
  const cleanKey = key.trim();
  const cleanValue = value.trim();
  if (
    !cleanValue ||
    (entry.keyEditable && !cleanKey) ||
    entry.valueStartColumn === undefined ||
    entry.valueEndColumn === undefined
  ) {
    return null;
  }
  const lineStart = lineStartOffset(content, entry.lineIndex);
  const replacements = [
    {
      start: lineStart + entry.valueStartColumn,
      end: lineStart + entry.valueEndColumn,
      value: cleanValue,
    },
  ];
  if (entry.keyEditable && cleanKey !== entry.key) {
    if (entry.keyStartColumn === undefined || entry.keyEndColumn === undefined) {
      return null;
    }
    replacements.push({
      start: lineStart + entry.keyStartColumn,
      end: lineStart + entry.keyEndColumn,
      value: cleanKey,
    });
  }
  const next = replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.value}${current.slice(replacement.end)}`,
      content,
    );
  const beforeParsed = parseFlatConfig(content, kind);
  const afterParsed = parseFlatConfig(next, kind);
  if (
    afterParsed.unsupportedCount !== beforeParsed.unsupportedCount ||
    afterParsed.entries.length !== beforeParsed.entries.length
  ) {
    return null;
  }
  const rediscovered = afterParsed.entries.find(
    (candidate) => candidate.lineIndex === entry.lineIndex,
  );
  if (
    !rediscovered ||
    rediscovered.key !== (entry.keyEditable ? cleanKey : entry.key) ||
    rediscovered.value !== cleanValue ||
    flatConfigEntryEditBlockReason(rediscovered, kind)
  ) {
    return null;
  }
  return next;
}

function lineStartOffset(content: string, lineIndex: number) {
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) return content.length;
    offset = newline + 1;
  }
  return offset;
}
