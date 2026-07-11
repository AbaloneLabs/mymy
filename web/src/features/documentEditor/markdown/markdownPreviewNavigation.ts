export function markdownPreviewLineElements(preview: HTMLElement) {
  return Array.from(
    preview.querySelectorAll<HTMLElement>("[data-markdown-line]"),
  )
    .filter((element) => Number.isFinite(Number(element.dataset.markdownLine)))
    .sort(
      (left, right) =>
        Number(left.dataset.markdownLine) - Number(right.dataset.markdownLine),
    );
}

export function nearestMarkdownPreviewLineElement(
  preview: HTMLElement,
  targetLine: number,
) {
  const elements = markdownPreviewLineElements(preview);
  let previous: HTMLElement | null = null;
  let next: HTMLElement | null = null;
  for (const element of elements) {
    const line = Number(element.dataset.markdownLine);
    if (line === targetLine) {
      return { element, line };
    }
    if (line < targetLine) {
      previous = element;
      continue;
    }
    next = element;
    break;
  }
  const element = previous ?? next ?? elements[0] ?? null;
  const line = element ? Number(element.dataset.markdownLine) : null;
  return { element, line: Number.isFinite(line) ? line : null };
}

export interface MarkdownPreviewLocationPoint {
  line: number;
  offset: number;
}

export function interpolateMarkdownPreviewOffset(
  points: MarkdownPreviewLocationPoint[],
  targetLine: number,
) {
  return interpolateLocation(points, targetLine, "line", "offset");
}

export function interpolateMarkdownPreviewLine(
  points: MarkdownPreviewLocationPoint[],
  targetOffset: number,
) {
  return interpolateLocation(points, targetOffset, "offset", "line");
}

export function markdownPreviewScrollTopForLine(
  preview: HTMLElement,
  targetLine: number,
) {
  return interpolateMarkdownPreviewOffset(
    markdownPreviewLocationPoints(preview),
    targetLine,
  );
}

export function markdownPreviewLineForScroll(preview: HTMLElement, inset = 32) {
  const line = interpolateMarkdownPreviewLine(
    markdownPreviewLocationPoints(preview),
    preview.scrollTop + inset,
  );
  return line === null ? null : Math.max(1, Math.round(line));
}

function markdownPreviewLocationPoints(preview: HTMLElement) {
  const previewTop = preview.getBoundingClientRect().top;
  return markdownPreviewLineElements(preview).map((element) => ({
    line: Number(element.dataset.markdownLine),
    offset:
      element.getBoundingClientRect().top - previewTop + preview.scrollTop,
  }));
}

function interpolateLocation(
  points: MarkdownPreviewLocationPoint[],
  target: number,
  input: keyof MarkdownPreviewLocationPoint,
  output: keyof MarkdownPreviewLocationPoint,
) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((left, right) => left[input] - right[input]);
  if (target <= sorted[0][input]) return sorted[0][output];
  const last = sorted.at(-1) as MarkdownPreviewLocationPoint;
  if (target >= last[input]) return last[output];
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (target > next[input]) continue;
    const previous = sorted[index - 1];
    const distance = next[input] - previous[input];
    if (distance <= 0) return previous[output];
    const ratio = (target - previous[input]) / distance;
    return previous[output] + (next[output] - previous[output]) * ratio;
  }
  return last[output];
}
