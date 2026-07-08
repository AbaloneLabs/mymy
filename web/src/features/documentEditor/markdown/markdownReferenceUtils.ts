import type { MarkdownReference } from "./markdownTypes";
import { stripInlineMarkdown } from "./markdownTextUtils";

export function markdownReferences(content: string): MarkdownReference[] {
  const references: MarkdownReference[] = [];
  const lines = content.split("\n");
  const lineOffsets = lineStartOffsets(lines);
  let previousPlainLine = "";
  let previousPlainLineOffset = 0;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const offset = lineOffsets[index] ?? 0;
    const lineNumber = index + 1;
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const footnoteDefinition = /^(\[\^([^\]]+)\]:\s*)(.*)$/.exec(line);
    if (footnoteDefinition) {
      const bodyStart = offset + footnoteDefinition[1].length;
      const continuationEndLine = footnoteDefinitionContinuationEnd(lines, index);
      const bodyEnd =
        (lineOffsets[continuationEndLine] ?? offset) +
        (lines[continuationEndLine]?.length ?? line.length);
      references.push({
        kind: "footnote",
        line: lineNumber,
        start: offset,
        end: bodyEnd,
        label: `[^${footnoteDefinition[2]}]`,
        target: content.slice(bodyStart, bodyEnd),
        labelStart: offset,
        labelEnd: offset + `[^${footnoteDefinition[2]}]`.length,
        targetStart: bodyStart,
        targetEnd: bodyEnd,
      });
    } else {
      collectInlineMarkdownReferences(line, offset, lineNumber, references);
      const referenceDefinition = /^(\[([^\]]+)\]:\s*)(\S+)(?:\s+(.+))?$/.exec(line);
      if (referenceDefinition) {
        const labelStart = offset + 1;
        const targetStart = offset + referenceDefinition[1].length;
        references.push({
          kind: "reference",
          line: lineNumber,
          start: offset,
          end: offset + line.length,
          label: referenceDefinition[2],
          target: referenceDefinition[3],
          labelStart,
          labelEnd: labelStart + referenceDefinition[2].length,
          targetStart,
          targetEnd: targetStart + referenceDefinition[3].length,
        });
      }
      const definition = /^(\s*:\s+)(.+)$/.exec(line);
      if (definition && previousPlainLine) {
        references.push({
          kind: "definition",
          line: lineNumber,
          start: previousPlainLineOffset,
          end: offset + line.length,
          label: previousPlainLine,
          target: definition[2],
          targetStart: offset + definition[1].length,
          targetEnd: offset + line.length,
        });
      }
    }

    const trimmed = line.trim();
    if (
      trimmed &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !trimmed.startsWith(":") &&
      !/^\[[^\]]+\]:/.test(trimmed)
    ) {
      previousPlainLine = stripInlineMarkdown(trimmed);
      previousPlainLineOffset = offset;
    } else if (!trimmed) {
      previousPlainLine = "";
      previousPlainLineOffset = offset;
    }
  }

  return references;
}

function lineStartOffsets(lines: string[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function footnoteDefinitionContinuationEnd(lines: string[], startIndex: number) {
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      const nextLine = lines[index + 1];
      if (nextLine && /^(?: {2,}|\t)/.test(nextLine)) {
        endIndex = index;
        continue;
      }
      break;
    }
    if (!/^(?: {2,}|\t)/.test(line)) break;
    endIndex = index;
  }
  return endIndex;
}

function collectInlineMarkdownReferences(
  line: string,
  lineOffset: number,
  lineNumber: number,
  references: MarkdownReference[],
) {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const linkPattern = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  const footnotePattern = /\[\^([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(line))) {
    const labelStart = lineOffset + match.index + 2;
    const targetStart = lineOffset + match.index + match[0].lastIndexOf("(") + 1;
    references.push({
      kind: "image",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1] || match[2],
      target: match[2],
      labelStart,
      labelEnd: labelStart + match[1].length,
      targetStart,
      targetEnd: targetStart + match[2].length,
    });
  }
  while ((match = linkPattern.exec(line))) {
    const labelStart = lineOffset + match.index + 1;
    const targetStart = lineOffset + match.index + match[0].lastIndexOf("(") + 1;
    references.push({
      kind: "link",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1],
      target: match[2],
      labelStart,
      labelEnd: labelStart + match[1].length,
      targetStart,
      targetEnd: targetStart + match[2].length,
    });
  }
  while ((match = footnotePattern.exec(line))) {
    references.push({
      kind: "footnote",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: `[^${match[1]}]`,
      labelStart: lineOffset + match.index,
      labelEnd: lineOffset + match.index + match[0].length,
    });
  }
}
