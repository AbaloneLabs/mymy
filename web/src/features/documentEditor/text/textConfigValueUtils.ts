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

export interface ConfigInlineArray {
  items: string[];
  quote: "'" | "\"" | null;
}

export interface ConfigInlineObject {
  entries: Array<{ key: string; value: string }>;
  separator: ":" | "=";
}

export function parseConfigInlineArray(value: string): ConfigInlineArray | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return { items: [], quote: null };
  const items: string[] = [];
  let quote: "'" | "\"" | null = null;
  let token = "";
  let activeQuote: "'" | "\"" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if ((character === "'" || character === '"') && body[index - 1] !== "\\") {
      activeQuote = activeQuote === character ? null : activeQuote ?? character;
      quote ??= character;
      token += character;
      continue;
    }
    if (character === "," && activeQuote === null) {
      items.push(unquoteConfigArrayItem(token.trim()));
      token = "";
      continue;
    }
    token += character;
  }
  items.push(unquoteConfigArrayItem(token.trim()));
  return { items, quote };
}

export function serializeConfigInlineArray(
  items: string[],
  quote: "'" | "\"" | null,
) {
  return `[${items.map((item) => quoteConfigArrayItem(item, quote)).join(", ")}]`;
}

export function parseConfigInlineObject(
  value: string,
  kind: "yaml" | "toml",
): ConfigInlineObject | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const body = trimmed.slice(1, -1).trim();
  const separator = topLevelSeparator(body) ?? (kind === "toml" ? "=" : ":");
  if (!body) return { entries: [], separator };
  return {
    separator,
    entries: splitTopLevelItems(body).map((item) => {
      const index = topLevelSeparatorIndex(item, separator);
      if (index < 0) return { key: item.trim(), value: "" };
      return {
        key: unquoteConfigObjectKey(item.slice(0, index).trim()),
        value: item.slice(index + 1).trim(),
      };
    }),
  };
}

export function serializeConfigInlineObject(object: ConfigInlineObject) {
  return `{ ${object.entries
    .filter((entry) => entry.key.trim())
    .map((entry) => `${quoteConfigObjectKey(entry.key.trim())} ${object.separator} ${entry.value.trim()}`)
    .join(", ")} }`;
}

function unquoteConfigArrayItem(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteConfigArrayItem(value: string, preferredQuote: "'" | "\"" | null) {
  const trimmed = value.trim();
  if (/^(?:true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(trimmed)) return trimmed;
  const quote = preferredQuote ?? '"';
  const escaped = quote === '"'
    ? value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    : value.replace(/'/g, "''");
  return `${quote}${escaped}${quote}`;
}

function splitTopLevelItems(value: string) {
  const items: string[] = [];
  let quote: "'" | "\"" | null = null;
  let depth = 0;
  let token = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "'" || character === '"') && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (quote === null && "[{(".includes(character)) {
      depth += 1;
    } else if (quote === null && "]})".includes(character)) {
      depth = Math.max(0, depth - 1);
    }
    if (character === "," && quote === null && depth === 0) {
      items.push(token.trim());
      token = "";
      continue;
    }
    token += character;
  }
  if (token.trim()) items.push(token.trim());
  return items;
}

function topLevelSeparator(value: string): ":" | "=" | null {
  const colon = topLevelSeparatorIndex(value, ":");
  const equals = topLevelSeparatorIndex(value, "=");
  if (colon < 0 && equals < 0) return null;
  if (colon >= 0 && (equals < 0 || colon < equals)) return ":";
  return "=";
}

function topLevelSeparatorIndex(value: string, separator: ":" | "=") {
  let quote: "'" | "\"" | null = null;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "'" || character === '"') && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (quote !== null) continue;
    if ("[{(".includes(character)) {
      depth += 1;
      continue;
    }
    if ("]})".includes(character)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && character === separator) return index;
  }
  return -1;
}

function unquoteConfigObjectKey(value: string) {
  return unquoteConfigArrayItem(value);
}

function quoteConfigObjectKey(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : quoteConfigArrayItem(value, '"');
}
