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
