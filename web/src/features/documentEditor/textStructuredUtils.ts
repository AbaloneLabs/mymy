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
  lineEndIndex?: number;
  key: string;
  value: string;
  path: string[];
  section?: string;
  indent: string;
  suffix: string;
  keyEditable: boolean;
  entryKind: "mapping" | "sequence" | "toml";
  valueHeader?: string;
  valueIndent?: string;
  valueStyle?: "yaml-block" | "toml-multiline";
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

export function splitStructuredTextLines(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function joinStructuredTextLines(lines: string[], originalContent: string) {
  return lines.join(structuredTextLineEnding(originalContent));
}

function structuredTextLineEnding(content: string) {
  return content.includes("\r\n") ? "\r\n" : "\n";
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
  const lines = splitStructuredTextLines(content);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") {
      continue;
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
        continue;
      }
      const blockHeader = yamlBlockScalarHeader(parsed.value);
      if (blockHeader) {
        const block = yamlBlockScalarValue(lines, lineIndex, indentSize);
        entries.push({
          lineIndex,
          lineEndIndex: block.endLineIndex,
          key,
          value: block.value,
          path,
          indent,
          suffix: parsed.suffix,
          keyEditable: true,
          entryKind: "mapping",
          valueHeader: blockHeader,
          valueIndent: block.indent,
          valueStyle: "yaml-block",
        });
        lineIndex = block.endLineIndex;
        continue;
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
      continue;
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
        continue;
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
      continue;
    }
    unsupportedCount += 1;
  }
  return { entries, unsupportedCount };
}

function parseTomlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  let unsupportedCount = 0;
  let currentSection = "";
  const lines = splitStructuredTextLines(content);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const table = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(trimmed);
    if (arrayTable || table) {
      currentSection = (arrayTable?.[1] ?? table?.[1] ?? "").trim();
      continue;
    }
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      unsupportedCount += 1;
      continue;
    }
    const key = match[2];
    const sectionPath = currentSection ? currentSection.split(".").filter(Boolean) : [];
    const multiline = tomlMultilineValue(lines, lineIndex, match[3]);
    if (multiline) {
      entries.push({
        lineIndex,
        lineEndIndex: multiline.endLineIndex,
        key,
        value: multiline.value,
        path: [...sectionPath, ...key.split(".").filter(Boolean)],
        section: currentSection,
        indent: match[1],
        suffix: multiline.suffix,
        keyEditable: true,
        entryKind: "toml",
        valueHeader: multiline.delimiter,
        valueStyle: "toml-multiline",
      });
      lineIndex = multiline.endLineIndex;
      continue;
    }
    const parsed = splitInlineComment(match[3]);
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
  }
  return { entries, unsupportedCount };
}

export function flatConfigLine(
  entry: ConfigEntry,
  key: string,
  value: string,
  kind: "yaml" | "toml",
) {
  return flatConfigLines(entry, key, value, kind)[0] ?? "";
}

export function flatConfigLines(
  entry: ConfigEntry,
  key: string,
  value: string,
  kind: "yaml" | "toml",
) {
  if (entry.valueStyle === "toml-multiline") {
    const delimiter = entry.valueHeader ?? '"""';
    return [
      `${entry.indent}${key} = ${delimiter}`,
      ...splitConfigMultilineValue(value),
      `${delimiter}${entry.suffix}`,
    ];
  }
  if (entry.valueStyle === "yaml-block") {
    const bodyIndent = entry.valueIndent ?? `${entry.indent}  `;
    return [
      `${entry.indent}${key}: ${entry.valueHeader ?? "|"}${entry.suffix}`,
      ...splitConfigMultilineValue(value).map((line) => `${bodyIndent}${line}`),
    ];
  }
  if (kind === "toml") return [`${entry.indent}${key} = ${value}${entry.suffix}`];
  if (entry.entryKind === "sequence") return [`${entry.indent}- ${value}${entry.suffix}`];
  return [`${entry.indent}${key}: ${value}${entry.suffix}`];
}

export function flatConfigEntryCanMove(
  entries: ConfigEntry[],
  entry: ConfigEntry,
  direction: -1 | 1,
) {
  return flatConfigEntryMoveTarget(entries, entry, direction) !== null;
}

export function flatConfigEntryCanDuplicate(entry: ConfigEntry) {
  return !entry.keyEditable;
}

export function moveFlatConfigEntry(
  content: string,
  entries: ConfigEntry[],
  entry: ConfigEntry,
  direction: -1 | 1,
) {
  const target = flatConfigEntryMoveTarget(entries, entry, direction);
  if (!target) return content;
  const lines = splitStructuredTextLines(content);
  const entryRange = flatConfigEntryBlockRange(lines, entries, entry);
  const targetRange = flatConfigEntryBlockRange(lines, entries, target);
  const insertionIndex = direction < 0 ? targetRange.start : targetRange.end;
  return joinStructuredTextLines(
    moveLineBlock(lines, entryRange.start, entryRange.end, insertionIndex),
    content,
  );
}

export function duplicateFlatConfigEntry(
  content: string,
  entry: ConfigEntry,
  kind: "yaml" | "toml",
) {
  if (!flatConfigEntryCanDuplicate(entry)) return content;
  const lines = splitStructuredTextLines(content);
  const insertAt = (entry.lineEndIndex ?? entry.lineIndex) + 1;
  lines.splice(insertAt, 0, ...flatConfigLines(entry, entry.key, entry.value, kind));
  return joinStructuredTextLines(lines, content);
}

function flatConfigEntryMoveTarget(
  entries: ConfigEntry[],
  entry: ConfigEntry,
  direction: -1 | 1,
) {
  const scope = flatConfigEntryScopeKey(entry);
  const scoped = entries
    .filter((candidate) => flatConfigEntryScopeKey(candidate) === scope)
    .sort((left, right) => left.lineIndex - right.lineIndex);
  const index = scoped.findIndex((candidate) => candidate.lineIndex === entry.lineIndex);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= scoped.length) return null;
  return scoped[nextIndex];
}

function flatConfigEntryScopeKey(entry: ConfigEntry) {
  if (entry.entryKind === "toml") return `toml:${entry.section ?? ""}`;
  return `yaml:${entry.path.slice(0, -1).join("\u0000")}`;
}

function flatConfigEntryBlockRange(
  lines: string[],
  entries: ConfigEntry[],
  entry: ConfigEntry,
) {
  const previousLine = previousFlatConfigEntryInScope(entries, entry)?.lineIndex;
  let start = entry.lineIndex;
  while (
    previousLine !== undefined &&
    start > previousLine + 1 &&
    isFlatConfigLeadingTrivia(lines[start - 1])
  ) {
    start -= 1;
  }
  return { start, end: (entry.lineEndIndex ?? entry.lineIndex) + 1 };
}

function previousFlatConfigEntryInScope(entries: ConfigEntry[], entry: ConfigEntry) {
  const scope = flatConfigEntryScopeKey(entry);
  return entries
    .filter(
      (candidate) =>
        candidate.lineIndex < entry.lineIndex &&
        flatConfigEntryScopeKey(candidate) === scope,
    )
    .sort((left, right) => right.lineIndex - left.lineIndex)[0];
}

function isFlatConfigLeadingTrivia(line: string | undefined) {
  const trimmed = line?.trim() ?? "";
  return trimmed === "" || trimmed.startsWith("#");
}

function moveLineBlock(
  lines: string[],
  start: number,
  end: number,
  insertionIndex: number,
) {
  const block = lines.slice(start, end);
  const next = [...lines.slice(0, start), ...lines.slice(end)];
  const adjustedInsertionIndex =
    insertionIndex > start ? insertionIndex - block.length : insertionIndex;
  next.splice(adjustedInsertionIndex, 0, ...block);
  return next;
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
    const lineEnding = structuredTextLineEnding(content);
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : lineEnding;
    return `${content}${suffix}${entry.key} = ${entry.value}${lineEnding}`;
  }
  const lines = splitStructuredTextLines(content);
  const sectionHeader = `[${entry.section}]`;
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);
  if (sectionIndex < 0) {
    const lineEnding = structuredTextLineEnding(content);
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : lineEnding;
    return `${content}${suffix}${sectionHeader}${lineEnding}${entry.key} = ${entry.value}${lineEnding}`;
  }
  let insertAt = sectionIndex + 1;
  while (insertAt < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[insertAt])) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, `${entry.key} = ${entry.value}`);
  return joinStructuredTextLines(lines, content);
}

export function deleteFlatConfigGroup(
  content: string,
  kind: "yaml" | "toml",
  path: string[],
) {
  if (path.length === 0) return content;
  return kind === "yaml"
    ? deleteYamlConfigGroup(content, path)
    : deleteTomlConfigGroup(content, path);
}

function appendYamlConfigEntry(content: string, parentPath: string, key: string, value: string) {
  const lines = splitStructuredTextLines(content);
  const path = parentPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (path.length === 0) {
    const lineEnding = structuredTextLineEnding(content);
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : lineEnding;
    return `${content}${suffix}${key}: ${value}${lineEnding}`;
  }
  const parent = findYamlParentLine(lines, path);
  if (!parent) {
    const lineEnding = structuredTextLineEnding(content);
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : lineEnding;
    return `${content}${suffix}${path.map((segment, index) => `${"  ".repeat(index)}${segment}:`).join(lineEnding)}${lineEnding}${"  ".repeat(path.length)}${key}: ${value}${lineEnding}`;
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
  return joinStructuredTextLines(lines, content);
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

function deleteYamlConfigGroup(content: string, path: string[]) {
  const lines = splitStructuredTextLines(content);
  const parent = findYamlParentLine(lines, path);
  if (!parent) return content;
  let end = parent.lineIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (!line.trim()) {
      end += 1;
      continue;
    }
    if (leadingWhitespace(line).length <= parent.indent) break;
    end += 1;
  }
  lines.splice(parent.lineIndex, end - parent.lineIndex);
  return joinStructuredTextLines(lines, content);
}

function deleteTomlConfigGroup(content: string, path: string[]) {
  const target = path.join(".");
  const removableLines = new Set<number>();
  parseTomlConfig(content).entries.forEach((entry) => {
    if (configPathStartsWith(entry.path, path)) removableLines.add(entry.lineIndex);
  });

  let removingSection = false;
  const lines = splitStructuredTextLines(content);
  lines.forEach((line, lineIndex) => {
    const section = tomlSectionName(line);
    if (section !== null) {
      removingSection = section === target || section.startsWith(`${target}.`);
      if (removingSection) removableLines.add(lineIndex);
      return;
    }
    if (removingSection) removableLines.add(lineIndex);
  });

  if (removableLines.size === 0) return content;
  return joinStructuredTextLines(
    lines.filter((_, lineIndex) => !removableLines.has(lineIndex)),
    content,
  );
}

function configPathStartsWith(path: string[], prefix: string[]) {
  return prefix.every((segment, index) => path[index] === segment);
}

function tomlSectionName(line: string) {
  const trimmed = line.trim();
  const table = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
  const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(trimmed);
  return (arrayTable?.[1] ?? table?.[1] ?? null)?.trim() ?? null;
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

function yamlBlockScalarHeader(value: string) {
  return /^[|>](?:[+-]?\d*|\d*[+-]?)?$/.test(value.trim()) ? value.trim() : null;
}

function yamlBlockScalarValue(
  lines: string[],
  headerLineIndex: number,
  headerIndent: number,
) {
  let endLineIndex = headerLineIndex;
  let bodyIndent: number | null = null;
  for (let index = headerLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim()) {
      const indent = leadingWhitespace(line).length;
      if (indent <= headerIndent) break;
      bodyIndent ??= indent;
    }
    endLineIndex = index;
  }
  const indent = " ".repeat(bodyIndent ?? headerIndent + 2);
  const value = lines
    .slice(headerLineIndex + 1, endLineIndex + 1)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trim() ? line.trimStart() : ""))
    .join("\n");
  return { endLineIndex, indent, value };
}

function tomlMultilineValue(lines: string[], lineIndex: number, rawValue: string) {
  const trimmed = rawValue.trimStart();
  const delimiter = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null;
  if (!delimiter) return null;
  const firstLinePrefixLength = rawValue.indexOf(delimiter) + delimiter.length;
  const firstLineAfterDelimiter = rawValue.slice(firstLinePrefixLength);
  const sameLineEnd = firstLineAfterDelimiter.indexOf(delimiter);
  if (sameLineEnd >= 0) {
    return {
      delimiter,
      endLineIndex: lineIndex,
      suffix: firstLineAfterDelimiter.slice(sameLineEnd + delimiter.length).trimEnd(),
      value: firstLineAfterDelimiter.slice(0, sameLineEnd),
    };
  }
  const valueLines = [firstLineAfterDelimiter];
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const closeIndex = lines[index].indexOf(delimiter);
    if (closeIndex >= 0) {
      valueLines.push(lines[index].slice(0, closeIndex));
      return {
        delimiter,
        endLineIndex: index,
        suffix: lines[index].slice(closeIndex + delimiter.length).trimEnd(),
        value: valueLines.join("\n"),
      };
    }
    valueLines.push(lines[index]);
  }
  return null;
}

function splitConfigMultilineValue(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
