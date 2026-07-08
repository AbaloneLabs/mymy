export function findYamlParentLine(
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

export function configPathStartsWith(path: string[], prefix: string[]) {
  return prefix.every((segment, index) => path[index] === segment);
}

export function tomlSectionName(line: string) {
  const trimmed = line.trim();
  const table = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
  const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(trimmed);
  return (arrayTable?.[1] ?? table?.[1] ?? null)?.trim() ?? null;
}

export function splitStructuredTextLines(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function joinStructuredTextLines(lines: string[], originalContent: string) {
  return lines.join(structuredTextLineEnding(originalContent));
}

export function structuredTextLineEnding(content: string) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
