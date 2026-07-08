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
  documentIndex?: number;
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
  valuePrefix?: string;
  yamlDecorators?: string[];
  sequencePrefix?: string;
  section?: string;
  valueHeader?: string;
  valueIndent?: string;
  valueStyle?: ConfigEntry["valueStyle"];
  jsonPropertyIndex?: number;
  jsonKeyStart?: number;
  jsonKeyEnd?: number;
  jsonValueStart?: number;
  jsonValueEnd?: number;
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
    documentIndex: entry.documentIndex,
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
    valuePrefix: entry.valuePrefix,
    yamlDecorators: entry.yamlDecorators,
    sequencePrefix: entry.sequencePrefix,
    section: entry.section,
    valueHeader: entry.valueHeader,
    valueIndent: entry.valueIndent,
    valueStyle: entry.valueStyle,
  };
}

function frontmatterConfigEntry(field: FrontmatterField): ConfigEntry {
  return {
    lineIndex: field.lineIndex,
    documentIndex: field.documentIndex,
    lineEndIndex: field.lineEndIndex,
    key: field.key,
    value: field.value,
    path: field.path,
    section: field.section,
    indent: field.indent ?? "",
    suffix: field.suffix ?? "",
    valuePrefix: field.valuePrefix,
    yamlDecorators: field.yamlDecorators,
    sequencePrefix: field.sequencePrefix,
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
  const scan = scanJsonFrontmatterObject(content);
  if (!scan) return [];
  return scan.properties.map((property) => ({
    lineIndex: property.index,
    key: property.key,
    value: jsonFrontmatterDisplayValue(property.value, property.rawValue),
    path: [property.key],
    parentLabel: "root",
    keyEditable: true,
    entryKind: "json" as const,
    jsonPropertyIndex: property.index,
    jsonKeyStart: property.keyStart,
    jsonKeyEnd: property.keyEnd,
    jsonValueStart: property.valueStart,
    jsonValueEnd: property.valueEnd,
  }));
}

function updateJsonFrontmatterField(
  content: string,
  field: FrontmatterField,
  key: string,
  value: string | undefined,
) {
  const scan = scanJsonFrontmatterObject(content);
  if (scan) {
    if (value === undefined) {
      return deleteJsonFrontmatterProperty(content, scan, field);
    }
    return upsertJsonFrontmatterProperty(content, scan, field, key, value);
  }
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

type JsonFrontmatterProperty = {
  index: number;
  key: string;
  value: unknown;
  rawValue: string;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
  separator: string;
  lineStart: number;
  lineEnd: number;
  commaStart?: number;
  commaEnd?: number;
};

type JsonFrontmatterScan = {
  object: Record<string, unknown>;
  objectStart: number;
  objectEnd: number;
  properties: JsonFrontmatterProperty[];
  lineEnding: "\n" | "\r\n";
  isMultiline: boolean;
};

function scanJsonFrontmatterObject(content: string): JsonFrontmatterScan | null {
  const object = parseJsonFrontmatterObject(content);
  if (!object) return null;
  const objectStart = skipJsonWhitespace(content, 0);
  if (content[objectStart] !== "{") return null;
  let index = skipJsonWhitespace(content, objectStart + 1);
  const properties: JsonFrontmatterProperty[] = [];
  while (index < content.length) {
    if (content[index] === "}") {
      return {
        object,
        objectStart,
        objectEnd: index,
        properties,
        lineEnding: content.includes("\r\n") ? "\r\n" : "\n",
        isMultiline: content.slice(objectStart, index + 1).includes("\n"),
      };
    }
    if (content[index] !== '"') return null;
    const keyStart = index;
    const keyEnd = scanJsonStringEnd(content, keyStart);
    if (keyEnd === null) return null;
    let separatorEnd = skipJsonWhitespace(content, keyEnd);
    if (content[separatorEnd] !== ":") return null;
    separatorEnd += 1;
    const valueStart = skipJsonWhitespace(content, separatorEnd);
    const rawValueEnd = scanJsonValueEnd(content, valueStart);
    if (rawValueEnd === null) return null;
    const valueEnd = trimJsonWhitespaceEnd(content, valueStart, rawValueEnd);
    const afterValue = skipJsonWhitespace(content, rawValueEnd);
    const commaStart = content[afterValue] === "," ? afterValue : undefined;
    const commaEnd = commaStart === undefined ? undefined : commaStart + 1;
    const rawKey = content.slice(keyStart, keyEnd);
    const key = parseJsonStringSource(rawKey);
    if (key === null) return null;
    const rawValue = content.slice(valueStart, valueEnd);
    properties.push({
      index: properties.length,
      key,
      value: parseJsonFrontmatterValue(rawValue),
      rawValue,
      keyStart,
      keyEnd,
      valueStart,
      valueEnd,
      separator: content.slice(keyEnd, valueStart),
      lineStart: jsonPropertyLineStart(content, keyStart, objectStart),
      lineEnd: jsonPropertyLineEnd(content, commaEnd ?? valueEnd),
      commaStart,
      commaEnd,
    });
    index = skipJsonWhitespace(content, commaEnd ?? rawValueEnd);
    if (commaEnd === undefined && content[index] !== "}") return null;
  }
  return null;
}

function upsertJsonFrontmatterProperty(
  content: string,
  scan: JsonFrontmatterScan,
  field: FrontmatterField,
  key: string,
  value: string,
) {
  const nextKey = key.trim();
  if (!nextKey) return content;
  const property = findJsonFrontmatterProperty(scan, field);
  const valueSource = serializeJsonFrontmatterValue(content, value, scan, property);
  if (property) {
    const source = `${JSON.stringify(nextKey)}${property.separator}${valueSource}`;
    return `${content.slice(0, property.keyStart)}${source}${content.slice(property.valueEnd)}`;
  }
  return insertJsonFrontmatterProperty(content, scan, nextKey, valueSource);
}

function deleteJsonFrontmatterProperty(
  content: string,
  scan: JsonFrontmatterScan,
  field: FrontmatterField,
) {
  const property = findJsonFrontmatterProperty(scan, field);
  if (!property) return content;
  if (scan.properties.length === 1) {
    const emptyBody = scan.isMultiline ? scan.lineEnding : "";
    return `${content.slice(0, scan.objectStart + 1)}${emptyBody}${content.slice(scan.objectEnd)}`;
  }
  if (property.commaEnd !== undefined) {
    const end = jsonRemovalEndAfterComma(content, property.commaEnd);
    return `${content.slice(0, property.lineStart)}${content.slice(end)}`;
  }
  const previous = scan.properties[property.index - 1];
  const start = previous?.commaStart ?? property.lineStart;
  const end = scan.isMultiline ? property.valueEnd : property.lineEnd;
  return `${content.slice(0, start)}${content.slice(end)}`;
}

function insertJsonFrontmatterProperty(
  content: string,
  scan: JsonFrontmatterScan,
  key: string,
  valueSource: string,
) {
  const propertySource = `${JSON.stringify(key)}: ${valueSource}`;
  if (scan.isMultiline) {
    const indent = inferJsonPropertyIndent(content, scan);
    if (scan.properties.length === 0) {
      return `${content.slice(0, scan.objectStart + 1)}${scan.lineEnding}${indent}${propertySource}${scan.lineEnding}${content.slice(scan.objectEnd)}`;
    }
    const last = scan.properties.at(-1);
    if (!last) return content;
    return `${content.slice(0, last.valueEnd)},${scan.lineEnding}${indent}${propertySource}${content.slice(last.valueEnd)}`;
  }
  const compactSeparator = inferCompactJsonSeparator(content, scan);
  if (scan.properties.length === 0) {
    const innerWhitespace = content.slice(scan.objectStart + 1, scan.objectEnd);
    if (innerWhitespace.length > 0) {
      return `${content.slice(0, scan.objectStart + 1)} ${propertySource} ${content.slice(scan.objectEnd)}`;
    }
    return `${content.slice(0, scan.objectStart + 1)}${propertySource}${content.slice(scan.objectEnd)}`;
  }
  return `${content.slice(0, scan.objectEnd)},${compactSeparator}${propertySource}${content.slice(scan.objectEnd)}`;
}

function findJsonFrontmatterProperty(
  scan: JsonFrontmatterScan,
  field: FrontmatterField,
) {
  if (field.jsonPropertyIndex !== undefined) {
    const property = scan.properties[field.jsonPropertyIndex];
    if (property?.key === field.key) return property;
  }
  return scan.properties.find((property) => property.key === field.key);
}

function serializeJsonFrontmatterValue(
  content: string,
  value: string,
  scan: JsonFrontmatterScan,
  property?: JsonFrontmatterProperty,
) {
  const parsed = parseJsonFrontmatterValue(value);
  const source =
    typeof parsed === "string"
      ? JSON.stringify(parsed)
      : JSON.stringify(parsed, null, scan.isMultiline ? 2 : 0);
  if (!source) return JSON.stringify("");
  if (!scan.isMultiline || !source.includes("\n")) return source;
  const indent = property
    ? jsonPropertyIndentFromRange(property)
    : inferJsonPropertyIndent(content, scan);
  return source.replace(/\n/g, `${scan.lineEnding}${indent}`);
}

function jsonFrontmatterDisplayValue(value: unknown, rawValue: string) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? rawValue;
}

function parseJsonStringSource(source: string) {
  try {
    const parsed = JSON.parse(source);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function skipJsonWhitespace(content: string, index: number) {
  let cursor = index;
  while (/[\s]/.test(content[cursor] ?? "")) cursor += 1;
  return cursor;
}

function trimJsonWhitespaceEnd(content: string, start: number, end: number) {
  let cursor = end;
  while (cursor > start && /[\s]/.test(content[cursor - 1] ?? "")) cursor -= 1;
  return cursor;
}

function scanJsonStringEnd(content: string, start: number) {
  if (content[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  return null;
}

function scanJsonValueEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      if (depth === 0) return index;
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 0) return index;
  }
  return null;
}

function jsonPropertyLineStart(content: string, keyStart: number, objectStart: number) {
  const lineStart = content.lastIndexOf("\n", keyStart - 1) + 1;
  if (lineStart <= objectStart) return keyStart;
  const prefix = content.slice(lineStart, keyStart);
  return /^[ \t]*$/.test(prefix) ? lineStart : keyStart;
}

function jsonPropertyLineEnd(content: string, end: number) {
  const lineEnd = content.indexOf("\n", end);
  return lineEnd === -1 ? end : lineEnd + 1;
}

function jsonRemovalEndAfterComma(content: string, commaEnd: number) {
  const nextLine = content.indexOf("\n", commaEnd);
  if (nextLine !== -1 && /^[ \t\r]*$/.test(content.slice(commaEnd, nextLine))) {
    return nextLine + 1;
  }
  return skipJsonWhitespace(content, commaEnd);
}

function inferJsonPropertyIndent(content: string, scan: JsonFrontmatterScan) {
  const first = scan.properties[0];
  if (first) return content.slice(first.lineStart, first.keyStart);
  const closingLineStart = content.lastIndexOf("\n", scan.objectEnd - 1) + 1;
  const closingIndent = content.slice(closingLineStart, scan.objectEnd);
  return /^[ \t]*$/.test(closingIndent) ? `${closingIndent}  ` : "  ";
}

function jsonPropertyIndentFromRange(property: JsonFrontmatterProperty) {
  return " ".repeat(Math.max(0, property.keyStart - property.lineStart));
}

function inferCompactJsonSeparator(content: string, scan: JsonFrontmatterScan) {
  const commaProperty = scan.properties.find(
    (property) => property.commaEnd !== undefined,
  );
  if (!commaProperty?.commaEnd) return " ";
  const nextProperty = scan.properties[commaProperty.index + 1];
  if (!nextProperty) return " ";
  return content.slice(commaProperty.commaEnd, nextProperty.keyStart);
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
