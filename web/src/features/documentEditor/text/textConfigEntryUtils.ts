import type { ConfigEntry } from "./textStructuredTypes";

export function configEntryParentLabel(entry: ConfigEntry) {
  if (entry.path.length <= 1) return entry.section || "root";
  return entry.path.slice(0, -1).join(".");
}

export function configEntryPathLabel(entry: ConfigEntry) {
  return entry.path.length > 0 ? entry.path.join(".") : "root";
}

export function configScalarType(value: string) {
  const trimmed = value.trim();
  if (value.includes("\n")) return "multiline";
  if (!trimmed) return "empty";
  if (/^(true|false)$/i.test(trimmed)) return "boolean";
  if (/^(null|~)$/i.test(trimmed)) return "null";
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return "number";
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    return "object";
  }
  return "string";
}

export function configEntryLineRange(entry: ConfigEntry) {
  return {
    start: entry.lineIndex,
    end: (entry.lineEndIndex ?? entry.lineIndex) + 1,
  };
}
