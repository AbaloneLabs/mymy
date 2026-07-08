import {
  leadingWhitespace,
  splitInlineComment,
  tomlMultilineValue,
  yamlBlockScalarHeader,
  yamlBlockScalarValue,
} from "./textConfigValueUtils";
import { splitStructuredTextLines } from "./textFlatConfigStructure";
import type { ConfigEntry } from "./textStructuredTypes";

export function parseFlatConfig(content: string, kind: "yaml" | "toml") {
  return kind === "yaml" ? parseYamlConfig(content) : parseTomlConfig(content);
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
