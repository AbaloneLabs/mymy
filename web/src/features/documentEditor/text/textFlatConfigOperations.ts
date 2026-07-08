import {
  configPathStartsWith,
  findYamlParentLine,
  joinStructuredTextLines,
  splitStructuredTextLines,
  structuredTextLineEnding,
  tomlSectionHeader,
  tomlSectionName,
} from "./textFlatConfigStructure";
import { parseFlatConfig } from "./textFlatConfigParsers";
import type { ConfigEntry } from "./textStructuredTypes";
import {
  leadingWhitespace,
  splitConfigMultilineValue,
} from "./textConfigValueUtils";

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
  const yamlValue = `${entry.valuePrefix ?? ""}${value}`;
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
      `${entry.indent}${key}: ${entry.valuePrefix ?? ""}${entry.valueHeader ?? "|"}${entry.suffix}`,
      ...splitConfigMultilineValue(value).map((line) => `${bodyIndent}${line}`),
    ];
  }
  if (kind === "toml") return [`${entry.indent}${key} = ${value}${entry.suffix}`];
  if (entry.sequencePrefix) {
    return [`${entry.indent}${entry.sequencePrefix}${key}: ${yamlValue}${entry.suffix}`];
  }
  if (entry.entryKind === "sequence") return [`${entry.indent}- ${yamlValue}${entry.suffix}`];
  return [`${entry.indent}${key}: ${yamlValue}${entry.suffix}`];
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
  const target = tomlAppendTarget(entry.section);
  const sectionIndex = findTomlAppendSectionIndex(lines, target);
  if (sectionIndex < 0) {
    const lineEnding = structuredTextLineEnding(content);
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : lineEnding;
    return `${content}${suffix}${target.header}${lineEnding}${entry.key} = ${entry.value}${lineEnding}`;
  }
  let insertAt = sectionIndex + 1;
  while (insertAt < lines.length && !tomlSectionHeader(lines[insertAt])) {
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
  const arrayTarget = tomlArrayTableTarget(target);
  if (arrayTarget) {
    const lines = splitStructuredTextLines(content);
    const sectionIndex = findTomlAppendSectionIndex(lines, arrayTarget);
    if (sectionIndex < 0) return content;
    let end = sectionIndex + 1;
    while (end < lines.length && !tomlSectionHeader(lines[end])) {
      end += 1;
    }
    lines.splice(sectionIndex, end - sectionIndex);
    return joinStructuredTextLines(lines, content);
  }

  parseFlatConfig(content, "toml").entries.forEach((entry) => {
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

function tomlAppendTarget(section: string) {
  const arrayTarget = tomlArrayTableTarget(section);
  if (arrayTarget) return arrayTarget;
  return {
    name: section,
    arrayIndex: null,
    header: `[${section}]`,
  };
}

function tomlArrayTableTarget(section: string) {
  const match = /^(.*)\.\[(\d+)\]$/.exec(section);
  if (!match) return null;
  return {
    name: match[1],
    arrayIndex: Number(match[2]),
    header: `[[${match[1]}]]`,
  };
}

function findTomlAppendSectionIndex(
  lines: string[],
  target: { name: string; arrayIndex: number | null; header: string },
) {
  let currentArrayIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const header = tomlSectionHeader(lines[lineIndex]);
    if (!header || header.name !== target.name) continue;
    if (target.arrayIndex === null) {
      if (!header.arrayTable) return lineIndex;
      continue;
    }
    if (!header.arrayTable) continue;
    if (currentArrayIndex === target.arrayIndex) return lineIndex;
    currentArrayIndex += 1;
  }
  return -1;
}
