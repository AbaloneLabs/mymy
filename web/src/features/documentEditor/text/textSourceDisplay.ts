import type {
  SourceFoldRange,
  SourceMinimapLine,
  SourceVisibleLine,
} from "./textSourceTypes";

export function sourceDisplayText(lines: SourceVisibleLine[]) {
  return lines
    .map((line) => {
      if (!line.hiddenLineCount) return line.text;
      const suffix = `  ... ${line.hiddenLineCount} folded lines`;
      return line.text.trim() ? `${line.text}${suffix}` : suffix.trimStart();
    })
    .join("\n");
}

export function activeSourceFoldIds(
  ids: ReadonlySet<string>,
  ranges: SourceFoldRange[],
) {
  if (ids.size === 0) return ids;
  const validIds = new Set(ranges.map((range) => range.id));
  return new Set(Array.from(ids).filter((id) => validIds.has(id)));
}

export function sourceMinimapLines(content: string): SourceMinimapLine[] {
  const lines = content.split("\n");
  const maxLines = 220;
  if (lines.length <= maxLines) {
    return lines.map((text, index) => ({ text, line: index + 1 }));
  }
  const step = Math.ceil(lines.length / maxLines);
  return lines
    .map((text, index) => ({ text, line: index + 1 }))
    .filter((_, index) => index % step === 0)
    .slice(0, maxLines);
}
