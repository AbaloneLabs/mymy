import {
  appendFlatConfigEntry,
  configEntryLineRange,
  flatConfigLines,
  joinStructuredTextLines,
  parseFlatConfig,
  splitStructuredTextLines,
} from "../text";
import type { ConfigEntry } from "../text";

export interface MarkdownFrontmatter {
  marker: "---" | "+++";
  format: MarkdownFrontmatterFormat;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  content: string;
  lineEnding: "\n" | "\r\n";
}

export interface FrontmatterField {
  lineIndex: number;
  lineEndIndex?: number;
  key: string;
  value: string;
  path: string[];
  parentLabel: string;
  keyEditable: boolean;
  entryKind: "yaml" | "toml" | "json" | "sequence";
  indent?: string;
  suffix?: string;
  section?: string;
  valueHeader?: string;
  valueIndent?: string;
  valueStyle?: ConfigEntry["valueStyle"];
}

export type MarkdownFrontmatterFormat = "yaml" | "toml" | "json";

export function parseFrontmatter(content: string): MarkdownFrontmatter | null {
  const opening = /^(---|\+\+\+)[ \t]*(\r?\n)/.exec(content);
  if (!opening) return null;
  const marker = opening[1] as "---" | "+++";
  const lineEnding = opening[2] === "\r\n" ? "\r\n" : "\n";
  const contentStart = opening[0].length;
  const afterOpening = content.slice(contentStart);
  const closing = new RegExp(
    `(^|\\r?\\n)${escapeRegExp(marker)}[ \\t]*(?:\\r?\\n|$)`,
  ).exec(afterOpening);
  if (!closing) return null;
  const contentEnd = contentStart + closing.index;
  const end = contentStart + closing.index + closing[0].length;
  const body = content.slice(contentStart, contentEnd);
  return {
    marker,
    start: 0,
    format: frontmatterFormat(marker, body),
    contentStart,
    contentEnd,
    end,
    content: body,
    lineEnding,
  };
}

export function replaceFrontmatterBody(content: string, body: string) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;
  const normalizedBody = body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, frontmatter.lineEnding);
  const bodyWithLineBreak =
    normalizedBody.endsWith("\n") || normalizedBody.endsWith("\r\n")
      ? normalizedBody
      : `${normalizedBody}${frontmatter.lineEnding}`;
  return `${content.slice(0, frontmatter.contentStart)}${bodyWithLineBreak}${frontmatter.marker}${frontmatter.lineEnding}${content.slice(frontmatter.end)}`;
}

export function parseFrontmatterFields(content: string, marker: "---" | "+++") {
  const format = frontmatterFormat(marker, content);
  if (format === "json") return parseJsonFrontmatterFields(content);
  return parseFlatConfig(content, format).entries.map((entry) =>
    frontmatterFieldFromConfigEntry(entry, format),
  );
}

export function formatFrontmatterField(key: string, value: string, marker: "---" | "+++") {
  return marker === "+++" ? `${key} = ${value}` : `${key}: ${value}`;
}

export function updateFrontmatterFieldBody(
  content: string,
  marker: "---" | "+++",
  field: FrontmatterField,
  key: string,
  value: string,
) {
  const format = frontmatterFormat(marker, content);
  if (format === "json") {
    return updateJsonFrontmatterField(content, field, key, value);
  }
  const lines = splitStructuredTextLines(content);
  const cleanKey = field.keyEditable ? key.trim() : field.key;
  if (!cleanKey) return content;
  const entry = frontmatterConfigEntry(field);
  const range = configEntryLineRange(entry);
  lines.splice(
    range.start,
    range.end - range.start,
    ...flatConfigLines(entry, cleanKey, value, format),
  );
  return joinStructuredTextLines(lines, content);
}

export function deleteFrontmatterFieldBody(
  content: string,
  marker: "---" | "+++",
  field: FrontmatterField,
) {
  const format = frontmatterFormat(marker, content);
  if (format === "json") return updateJsonFrontmatterField(content, field, "", undefined);
  const lines = splitStructuredTextLines(content);
  const range = configEntryLineRange(frontmatterConfigEntry(field));
  lines.splice(range.start, range.end - range.start);
  return joinStructuredTextLines(lines, content);
}

export function addFrontmatterFieldBody(
  content: string,
  marker: "---" | "+++",
  key: string,
  value: string,
) {
  const cleanKey = key.trim();
  if (!cleanKey) return content;
  const format = frontmatterFormat(marker, content);
  if (format === "json") {
    return updateJsonFrontmatterField(
      content,
      {
        lineIndex: -1,
        key: cleanKey,
        value: "",
        path: [cleanKey],
        parentLabel: "root",
        keyEditable: true,
        entryKind: "json",
      },
      cleanKey,
      value,
    );
  }
  return appendFlatConfigEntry(content, {
    key: cleanKey,
    kind: format,
    section: "",
    value,
  }).replace(/\n$/, "");
}

function frontmatterFormat(
  marker: "---" | "+++",
  content: string,
): MarkdownFrontmatterFormat {
  if (marker === "+++") return "toml";
  return content.trimStart().startsWith("{") ? "json" : "yaml";
}

function frontmatterFieldFromConfigEntry(
  entry: ConfigEntry,
  format: "yaml" | "toml",
): FrontmatterField {
  return {
    lineIndex: entry.lineIndex,
    lineEndIndex: entry.lineEndIndex,
    key: entry.key,
    value: entry.value,
    path: entry.path,
    parentLabel:
      entry.path.length > 1 ? entry.path.slice(0, -1).join(".") : entry.section || "root",
    keyEditable: entry.keyEditable,
    entryKind: entry.entryKind === "sequence" ? "sequence" : format,
    indent: entry.indent,
    suffix: entry.suffix,
    section: entry.section,
    valueHeader: entry.valueHeader,
    valueIndent: entry.valueIndent,
    valueStyle: entry.valueStyle,
  };
}

function frontmatterConfigEntry(field: FrontmatterField): ConfigEntry {
  return {
    lineIndex: field.lineIndex,
    lineEndIndex: field.lineEndIndex,
    key: field.key,
    value: field.value,
    path: field.path,
    section: field.section,
    indent: field.indent ?? "",
    suffix: field.suffix ?? "",
    keyEditable: field.keyEditable,
    valueHeader: field.valueHeader,
    valueIndent: field.valueIndent,
    valueStyle: field.valueStyle,
    entryKind:
      field.entryKind === "toml"
        ? "toml"
        : field.entryKind === "sequence"
          ? "sequence"
          : "mapping",
  };
}

function parseJsonFrontmatterFields(content: string): FrontmatterField[] {
  const object = parseJsonFrontmatterObject(content);
  if (!object) return [];
  return Object.entries(object).map(([key, value], index) => ({
    lineIndex: index,
    key,
    value:
      typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "",
    path: [key],
    parentLabel: "root",
    keyEditable: true,
    entryKind: "json" as const,
  }));
}

function updateJsonFrontmatterField(
  content: string,
  field: FrontmatterField,
  key: string,
  value: string | undefined,
) {
  const object = parseJsonFrontmatterObject(content);
  if (!object) return content;
  const nextKey = key.trim();
  const next: Record<string, unknown> = { ...object };
  delete next[field.key];
  if (nextKey && value !== undefined) {
    next[nextKey] = parseJsonFrontmatterValue(value);
  }
  return JSON.stringify(next, null, 2);
}

function parseJsonFrontmatterObject(content: string) {
  try {
    const parsed = JSON.parse(content || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseJsonFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
