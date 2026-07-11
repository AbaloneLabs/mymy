import {
  leadingWhitespace,
  splitInlineComment,
  tomlMultilineValue,
  yamlBlockScalarHeader,
  yamlBlockScalarValue,
} from "./textConfigValueUtils";
import {
  splitStructuredTextLines,
  tomlSectionHeader,
} from "./textFlatConfigStructure";
import type { ConfigEntry } from "./textStructuredTypes";

export function parseFlatConfig(content: string, kind: "yaml" | "toml") {
  return kind === "yaml" ? parseYamlConfig(content) : parseTomlConfig(content);
}

function parseYamlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  const stack: Array<{ indent: number; key: string }> = [];
  const sequenceCounters = new Map<string, number>();
  let unsupportedCount = 0;
  let documentIndex = 0;
  let documentCount = 1;
  let sawExplicitDocumentStart = false;
  const lines = splitStructuredTextLines(content);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (sawExplicitDocumentStart || entries.length > 0) {
        documentIndex += 1;
        documentCount = Math.max(documentCount, documentIndex + 1);
      }
      sawExplicitDocumentStart = true;
      stack.length = 0;
      sequenceCounters.clear();
      continue;
    }
    if (trimmed === "...") {
      stack.length = 0;
      sequenceCounters.clear();
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) {
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
      const decorated = yamlValueDecorators(parsed.value);
      const path = [...stack.map((item) => item.key), key];
      const keyStartColumn = line.indexOf(key, mapping[1].length);
      const valueStartColumn = decorated.value
        ? line.indexOf(decorated.value, keyStartColumn + key.length)
        : -1;
      if (!decorated.value) {
        stack.push({ indent: indentSize, key });
        continue;
      }
      const blockHeader = yamlBlockScalarHeader(decorated.value);
      if (blockHeader) {
        const block = yamlBlockScalarValue(lines, lineIndex, indentSize);
        entries.push({
          documentIndex,
          lineIndex,
          lineEndIndex: block.endLineIndex,
          key,
          keyStartColumn,
          keyEndColumn: keyStartColumn + key.length,
          value: block.value,
          path,
          indent,
          suffix: parsed.suffix,
          valuePrefix: decorated.prefix,
          yamlDecorators: decorated.decorators,
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
        documentIndex,
        lineIndex,
        key,
        keyStartColumn,
        keyEndColumn: keyStartColumn + key.length,
        value: decorated.value,
        valueStartColumn,
        valueEndColumn: valueStartColumn + decorated.value.length,
        path,
        indent,
        suffix: parsed.suffix,
        valuePrefix: decorated.prefix,
        yamlDecorators: decorated.decorators,
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
      const decorated = yamlValueDecorators(parsed.value);
      const inlineMapping = /^([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/.exec(
        decorated.value,
      );
      if (inlineMapping) {
        const itemPath = [...parentPath, `[${index}]`];
        const key = inlineMapping[1];
        const valueDecorated = yamlValueDecorators(inlineMapping[2]);
        stack.push({ indent: indentSize, key: `[${index}]` });
        if (!valueDecorated.value) {
          stack.push({ indent: indentSize + 1, key });
          continue;
        }
        const keyStartColumn = line.indexOf(key, indent.length + 1);
        const valueStartColumn = line.indexOf(
          valueDecorated.value,
          keyStartColumn + key.length,
        );
        entries.push({
          documentIndex,
          lineIndex,
          key,
          keyStartColumn,
          keyEndColumn: keyStartColumn + key.length,
          value: valueDecorated.value,
          valueStartColumn,
          valueEndColumn: valueStartColumn + valueDecorated.value.length,
          path: [...itemPath, key],
          indent,
          suffix: parsed.suffix,
          valuePrefix: `${decorated.prefix}${valueDecorated.prefix}`,
          yamlDecorators: [
            ...decorated.decorators,
            ...valueDecorated.decorators,
          ],
          sequencePrefix: "- ",
          keyEditable: true,
          entryKind: "mapping",
        });
        continue;
      }
      if (!decorated.value) {
        unsupportedCount += 1;
        continue;
      }
      entries.push({
        documentIndex,
        lineIndex,
        key: `[${index}]`,
        value: decorated.value,
        valueStartColumn: line.indexOf(decorated.value, indent.length + 1),
        valueEndColumn:
          line.indexOf(decorated.value, indent.length + 1) +
          decorated.value.length,
        path: [...parentPath, `[${index}]`],
        indent,
        suffix: parsed.suffix,
        valuePrefix: decorated.prefix,
        yamlDecorators: decorated.decorators,
        keyEditable: false,
        entryKind: "sequence",
      });
      continue;
    }
    unsupportedCount += 1;
  }
  return { entries, unsupportedCount, documentCount };
}

function parseTomlConfig(content: string) {
  const entries: ConfigEntry[] = [];
  let unsupportedCount = 0;
  let currentSectionPath: string[] = [];
  let currentSectionScope = "";
  const arrayTableCounts = new Map<string, number>();
  const lines = splitStructuredTextLines(content);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = tomlSectionHeader(trimmed);
    if (header) {
      const sectionPath = header.name.split(".").filter(Boolean);
      if (header.arrayTable) {
        const index = arrayTableCounts.get(header.name) ?? 0;
        arrayTableCounts.set(header.name, index + 1);
        currentSectionPath = [...sectionPath, `[${index}]`];
        currentSectionScope = `${header.name}.[${index}]`;
      } else {
        currentSectionPath = sectionPath;
        currentSectionScope = header.name;
      }
      continue;
    }
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      unsupportedCount += 1;
      continue;
    }
    const key = match[2];
    const keyStartColumn = line.indexOf(key, match[1].length);
    const sectionPath = currentSectionPath;
    const multiline = tomlMultilineValue(lines, lineIndex, match[3]);
    if (multiline) {
      entries.push({
        lineIndex,
        lineEndIndex: multiline.endLineIndex,
        key,
        keyStartColumn,
        keyEndColumn: keyStartColumn + key.length,
        value: multiline.value,
        path: [...sectionPath, ...key.split(".").filter(Boolean)],
        section: currentSectionScope,
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
    const valueStartColumn = line.indexOf(
      parsed.value,
      keyStartColumn + key.length,
    );
    entries.push({
      lineIndex,
      key,
      keyStartColumn,
      keyEndColumn: keyStartColumn + key.length,
      value: parsed.value,
      valueStartColumn,
      valueEndColumn: valueStartColumn + parsed.value.length,
      path: [...sectionPath, ...key.split(".").filter(Boolean)],
      section: currentSectionScope,
      indent: match[1],
      suffix: parsed.suffix,
      keyEditable: true,
      entryKind: "toml",
    });
  }
  return { entries, unsupportedCount, documentCount: 1 };
}

function yamlValueDecorators(value: string) {
  let rest = value.trimStart();
  const leading = value.slice(0, value.length - rest.length);
  const decorators: string[] = [];
  while (rest.startsWith("!") || rest.startsWith("&")) {
    const match = /^(![^\s[\]{},]+|&[A-Za-z0-9_.-]+)(?:\s+|$)/.exec(rest);
    if (!match) break;
    decorators.push(match[1]);
    rest = rest.slice(match[0].length).trimStart();
  }
  const prefix = decorators.length > 0 ? `${leading}${decorators.join(" ")} ` : "";
  return {
    decorators,
    prefix,
    value: rest,
  };
}
