export type MarkdownSourceAnchor = {
  start: number;
  end: number;
  affinity: "left" | "right";
};

/**
 * Pending source operations are rebased after every accepted local edit. The
 * edit is represented by its longest unchanged prefix and suffix, which is
 * sufficient because each textarea/command update is one atomic replacement.
 * Repeating this transform composes multiple edits without retaining a stale
 * full-document closure.
 */
export function rebaseMarkdownSourceAnchor(
  anchor: MarkdownSourceAnchor,
  before: string,
  after: string,
): MarkdownSourceAnchor {
  if (before === after) return anchor;
  const prefixLength = commonPrefixLength(before, after);
  const suffixLength = commonSuffixLength(before, after, prefixLength);
  return {
    ...anchor,
    start: transformOffset(anchor.start, anchor.affinity),
    end: transformOffset(anchor.end, anchor.affinity),
  };

  function transformOffset(offset: number, affinity: "left" | "right") {
    const beforeChangeEnd = before.length - suffixLength;
    const afterChangeEnd = after.length - suffixLength;
    if (offset < prefixLength) return offset;
    if (offset > beforeChangeEnd) return offset + after.length - before.length;
    if (offset === prefixLength && prefixLength === beforeChangeEnd) {
      return affinity === "right" ? afterChangeEnd : prefixLength;
    }
    if (offset === beforeChangeEnd) return afterChangeEnd;
    return affinity === "right" ? afterChangeEnd : prefixLength;
  }
}

function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number) {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}
