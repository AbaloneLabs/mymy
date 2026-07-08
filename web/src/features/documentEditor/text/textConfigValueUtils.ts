export function leadingWhitespace(value: string) {
  return /^\s*/.exec(value)?.[0] ?? "";
}

export function splitInlineComment(value: string) {
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

export function yamlBlockScalarHeader(value: string) {
  return /^[|>](?:[+-]?\d*|\d*[+-]?)?$/.test(value.trim()) ? value.trim() : null;
}

export function yamlBlockScalarValue(
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
    .map((line) =>
      line.startsWith(indent)
        ? line.slice(indent.length)
        : line.trim()
          ? line.trimStart()
          : "",
    )
    .join("\n");
  return { endLineIndex, indent, value };
}

export function tomlMultilineValue(
  lines: string[],
  lineIndex: number,
  rawValue: string,
) {
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

export function splitConfigMultilineValue(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
