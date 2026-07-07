import { isRecord } from "./models";
import { cursorPosition } from "./textSourceUtils";
import type { TextEditorKind } from "./textSourceUtils";

/**
 * Structured text support is deliberately kept as lightweight parsing and
 * diagnostics instead of a full YAML/TOML/JSON Schema engine. The editor needs
 * predictable inline edits and useful warnings without inventing data that is
 * not present in the user's file, so unsupported shapes remain visible in
 * source mode while flat entries get a focused table-like editing surface.
 */
export interface SourceDiagnostic {
  line?: number;
  path?: string;
  message: string;
}

export interface ConfigEntry {
  lineIndex: number;
  key: string;
  value: string;
  path: string[];
  section?: string;
  indent: string;
  suffix: string;
  keyEditable: boolean;
  entryKind: "mapping" | "sequence" | "toml";
}

export function sourceDiagnostics(content: string, kind: TextEditorKind): SourceDiagnostic[] {
  if (kind === "json") {
    try {
      JSON.parse(content || "null");
      return [];
    } catch (error) {
      return [jsonParseDiagnostic(content, error)];
    }
  }
  if (kind === "yaml") {
    const diagnostics = content
      .split("\n")
      .map((line, index): SourceDiagnostic | null =>
        /^\t+/.test(line)
          ? { line: index + 1, message: "YAML indentation should use spaces." }
          : null,
      )
      .filter((diagnostic): diagnostic is SourceDiagnostic => Boolean(diagnostic));
    diagnostics.push(...duplicateConfigPathDiagnostics(content, "yaml"));
    return diagnostics;
  }
  if (kind === "toml") {
    return duplicateConfigPathDiagnostics(content, "toml");
  }
  return [];
}

export function jsonSchemaDiagnostics(
  value: unknown,
  schemaContent: string,
  enabled: boolean,
): SourceDiagnostic[] {
  if (!enabled || !schemaContent.trim()) return [];
  let schema: unknown;
  try {
    schema = JSON.parse(schemaContent);
  } catch (error) {
    return [
      {
        path: "schema",
        message: error instanceof Error ? error.message : "Invalid JSON Schema",
      },
    ];
  }
  if (value === undefined) return [];
  return validateJsonSchemaValue(value, schema, "$");
}

function validateJsonSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
): SourceDiagnostic[] {
  if (!isRecord(schema)) return [];
  const diagnostics: SourceDiagnostic[] = [];
  const expectedTypes = jsonSchemaTypes(schema.type);
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => jsonValueMatchesType(value, type))) {
    diagnostics.push({
      path,
      message: `Expected ${expectedTypes.join(" or ")}, got ${jsonValueType(value)}.`,
    });
    return diagnostics;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => stableJsonLike(item) === stableJsonLike(value))) {
    diagnostics.push({ path, message: "Value is not in schema enum." });
  }
  if ("const" in schema && stableJsonLike(schema.const) !== stableJsonLike(value)) {
    diagnostics.push({ path, message: "Value does not match schema const." });
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    required.forEach((key) => {
      if (!(key in value)) diagnostics.push({ path: `${path}.${key}`, message: "Required key is missing." });
    });
    if (isRecord(schema.properties)) {
      Object.entries(schema.properties).forEach(([key, propertySchema]) => {
        if (key in value) {
          diagnostics.push(
            ...validateJsonSchemaValue(value[key], propertySchema, `${path}.${key}`),
          );
        }
      });
    }
    if (schema.additionalProperties === false && isRecord(schema.properties)) {
      const properties = schema.properties;
      Object.keys(value).forEach((key) => {
        if (!(key in properties)) {
          diagnostics.push({
            path: `${path}.${key}`,
            message: "Additional property is not allowed.",
          });
        }
      });
    }
  }

  if (Array.isArray(value) && schema.items) {
    const minItems = jsonSchemaNumber(schema.minItems);
    const maxItems = jsonSchemaNumber(schema.maxItems);
    if (minItems !== undefined && value.length < minItems) {
      diagnostics.push({ path, message: `Expected at least ${minItems} items.` });
    }
    if (maxItems !== undefined && value.length > maxItems) {
      diagnostics.push({ path, message: `Expected at most ${maxItems} items.` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      value.forEach((item, index) => {
        const key = stableJsonLike(item);
        if (seen.has(key)) {
          diagnostics.push({
            path: `${path}[${index}]`,
            message: "Array item is not unique.",
          });
        }
        seen.add(key);
      });
    }
    value.forEach((item, index) => {
      diagnostics.push(
        ...validateJsonSchemaValue(item, schema.items, `${path}[${index}]`),
      );
    });
  }

  if (typeof value === "string") {
    const minLength = jsonSchemaNumber(schema.minLength);
    const maxLength = jsonSchemaNumber(schema.maxLength);
    if (minLength !== undefined && value.length < minLength) {
      diagnostics.push({ path, message: `Expected at least ${minLength} characters.` });
    }
    if (maxLength !== undefined && value.length > maxLength) {
      diagnostics.push({ path, message: `Expected at most ${maxLength} characters.` });
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          diagnostics.push({ path, message: "String does not match schema pattern." });
        }
      } catch {
        diagnostics.push({ path: "schema.pattern", message: "Invalid schema pattern." });
      }
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const minimum = jsonSchemaNumber(schema.minimum);
    const maximum = jsonSchemaNumber(schema.maximum);
    const exclusiveMinimum = jsonSchemaNumber(schema.exclusiveMinimum);
    const exclusiveMaximum = jsonSchemaNumber(schema.exclusiveMaximum);
    if (minimum !== undefined && value < minimum) {
      diagnostics.push({ path, message: `Expected value >= ${minimum}.` });
    }
    if (maximum !== undefined && value > maximum) {
      diagnostics.push({ path, message: `Expected value <= ${maximum}.` });
    }
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      diagnostics.push({ path, message: `Expected value > ${exclusiveMinimum}.` });
    }
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      diagnostics.push({ path, message: `Expected value < ${exclusiveMaximum}.` });
    }
  }

  return diagnostics;
}

function jsonSchemaTypes(value: unknown) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function jsonValueMatchesType(value: unknown, type: string) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function jsonValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function stableJsonLike(value: unknown) {
  return JSON.stringify(value);
}

function jsonParseDiagnostic(content: string, error: unknown): SourceDiagnostic {
  const message = error instanceof Error ? error.message : "Invalid JSON";
  const position = /position\s+(\d+)/i.exec(message)?.[1];
  if (!position) return { message };
  const offset = Number(position);
  if (!Number.isFinite(offset)) return { message };
  const cursor = cursorPosition(content, offset, offset);
  return {
    line: cursor.line,
    message: `${message} at column ${cursor.column}`,
  };
}

function jsonSchemaNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseFlatConfig(content: string, kind: "yaml" | "toml") {
  return kind === "yaml" ? parseYamlConfig(content) : parseTomlConfig(content);
}

function duplicateConfigPathDiagnostics(
  content: string,
  kind: "yaml" | "toml",
): SourceDiagnostic[] {
  const seen = new Map<string, number>();
  const diagnostics: SourceDiagnostic[] = [];
  for (const entry of parseFlatConfig(content, kind).entries) {
    const path = configEntryPathLabel(entry);
    const existingLine = seen.get(path);
    if (existingLine !== undefined) {
      diagnostics.push({
        line: entry.lineIndex + 1,
        path,
        message: `Duplicate key; first defined on line ${existingLine}.`,
      });
      continue;
    }
    seen.set(path, entry.lineIndex + 1);
  }
  return diagnostics;
}

function parseYamlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  const stack: Array<{ indent: number; key: string }> = [];
  const sequenceCounters = new Map<string, number>();
  let unsupportedCount = 0;
  content.split("\n").forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") {
      return;
    }
    const indent = leadingWhitespace(line);
    const indentSize = indent.length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indentSize) {
      stack.pop();
    }
    const mapping = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (mapping) {
      const key = mapping[2];
      const parsed = splitInlineComment(mapping[3]);
      const path = [...stack.map((item) => item.key), key];
      if (!parsed.value) {
        stack.push({ indent: indentSize, key });
        return;
      }
      entries.push({
        lineIndex,
        key,
        value: parsed.value,
        path,
        indent,
        suffix: parsed.suffix,
        keyEditable: true,
        entryKind: "mapping",
      });
      return;
    }
    const sequence = /^(\s*)-\s*(.*?)\s*$/.exec(line);
    if (sequence) {
      const parentPath = stack.map((item) => item.key);
      const parentKey = parentPath.join(".");
      const index = sequenceCounters.get(parentKey) ?? 0;
      sequenceCounters.set(parentKey, index + 1);
      const parsed = splitInlineComment(sequence[2]);
      if (!parsed.value || /^[A-Za-z0-9_.-]+\s*:\s*/.test(parsed.value)) {
        unsupportedCount += 1;
        return;
      }
      entries.push({
        lineIndex,
        key: `[${index}]`,
        value: parsed.value,
        path: [...parentPath, `[${index}]`],
        indent,
        suffix: parsed.suffix,
        keyEditable: false,
        entryKind: "sequence",
      });
      return;
    }
    unsupportedCount += 1;
  });
  return { entries, unsupportedCount };
}

function parseTomlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  let unsupportedCount = 0;
  let currentSection = "";
  content.split("\n").forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const table = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(trimmed);
    if (arrayTable || table) {
      currentSection = (arrayTable?.[1] ?? table?.[1] ?? "").trim();
      return;
    }
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      unsupportedCount += 1;
      return;
    }
    const key = match[2];
    const parsed = splitInlineComment(match[3]);
    const sectionPath = currentSection ? currentSection.split(".").filter(Boolean) : [];
    entries.push({
      lineIndex,
      key,
      value: parsed.value,
      path: [...sectionPath, ...key.split(".").filter(Boolean)],
      section: currentSection,
      indent: match[1],
      suffix: parsed.suffix,
      keyEditable: true,
      entryKind: "toml",
    });
  });
  return { entries, unsupportedCount };
}

export function flatConfigLine(
  entry: ConfigEntry,
  key: string,
  value: string,
  kind: "yaml" | "toml",
) {
  if (kind === "toml") return `${entry.indent}${key} = ${value}${entry.suffix}`;
  if (entry.entryKind === "sequence") return `${entry.indent}- ${value}${entry.suffix}`;
  return `${entry.indent}${key}: ${value}${entry.suffix}`;
}

export function appendFlatConfigEntry(
  content: string,
  entry: {
    key: string;
    kind: "yaml" | "toml";
    section: string;
    value: string;
  },
) {
  if (entry.kind === "yaml") {
    return appendYamlConfigEntry(content, entry.section, entry.key, entry.value);
  }
  if (!entry.section) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${entry.key} = ${entry.value}\n`;
  }
  const lines = content.split("\n");
  const sectionHeader = `[${entry.section}]`;
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);
  if (sectionIndex < 0) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${sectionHeader}\n${entry.key} = ${entry.value}\n`;
  }
  let insertAt = sectionIndex + 1;
  while (insertAt < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[insertAt])) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, `${entry.key} = ${entry.value}`);
  return lines.join("\n");
}

function appendYamlConfigEntry(content: string, parentPath: string, key: string, value: string) {
  const lines = content.split("\n");
  const path = parentPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (path.length === 0) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${key}: ${value}\n`;
  }
  const parent = findYamlParentLine(lines, path);
  if (!parent) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return `${content}${suffix}${path.map((segment, index) => `${"  ".repeat(index)}${segment}:`).join("\n")}\n${"  ".repeat(path.length)}${key}: ${value}\n`;
  }
  let insertAt = parent.lineIndex + 1;
  while (
    insertAt < lines.length &&
    (lines[insertAt].trim() === "" ||
      leadingWhitespace(lines[insertAt]).length > parent.indent)
  ) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, `${" ".repeat(parent.indent + 2)}${key}: ${value}`);
  return lines.join("\n");
}

function findYamlParentLine(
  lines: string[],
  path: string[],
): { lineIndex: number; indent: number } | null {
  const stack: Array<{ indent: number; key: string }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const currentPath = [...stack.map((item) => item.key), match[2]];
    if (currentPath.join(".") === path.join(".") && !match[3].trim()) {
      return { lineIndex, indent };
    }
    if (!match[3].trim()) stack.push({ indent, key: match[2] });
  }
  return null;
}

export function configEntryParentLabel(entry: ConfigEntry) {
  if (entry.path.length <= 1) return entry.section || "root";
  return entry.path.slice(0, -1).join(".");
}

export function configEntryPathLabel(entry: ConfigEntry) {
  return entry.path.length > 0 ? entry.path.join(".") : "root";
}

export function configScalarType(value: string) {
  const trimmed = value.trim();
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

function leadingWhitespace(value: string) {
  return /^\s*/.exec(value)?.[0] ?? "";
}

function splitInlineComment(value: string) {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if ((ch === '"' || ch === "'") && value[index - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
    }
    if (ch === "#" && quote === null && (index === 0 || /\s/.test(value[index - 1]))) {
      return {
        value: value.slice(0, index).trimEnd(),
        suffix: value.slice(index > 0 ? index - 1 : index),
      };
    }
  }
  return { value: value.trimEnd(), suffix: "" };
}
