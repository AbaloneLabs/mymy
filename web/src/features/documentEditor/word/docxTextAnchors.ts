import type {
  DocxBlock,
  DocxCommentRange,
  DocxHyperlinkRange,
  DocxNoteReference,
  DocxRun,
  DocxTextAnchorAffinity,
} from "../shared/models";

type TextRange = { start: number; end: number };

/**
 * Inline OOXML features use text offsets instead of matching visible strings.
 * The offset is stable even when the same text occurs more than once, while
 * the affinity records which side owns text inserted exactly at a boundary.
 * All editor text mutations pass through this module so the displayed range
 * and the durable package marker cannot silently diverge.
 */
export function docxCommentRanges(block: DocxBlock): DocxCommentRange[] {
  if (block.commentRanges) return block.commentRanges.map(clampCommentRange(block));
  return block.commentId && block.text.length > 0
    ? [{ commentId: block.commentId, start: 0, end: block.text.length }]
    : [];
}

export function docxHyperlinkRanges(block: DocxBlock): DocxHyperlinkRange[] {
  if (block.hyperlinks) return block.hyperlinks.map(clampHyperlinkRange(block));
  return block.target && block.text.length > 0
    ? [
        {
          id: `${block.id}-link-1`,
          start: 0,
          end: block.text.length,
          target: block.target,
          relationshipId: block.relationshipId,
        },
      ]
    : [];
}

export function docxNoteReferences(block: DocxBlock): DocxNoteReference[] {
  if (block.noteReferences) {
    return block.noteReferences.map((reference) => ({
      ...reference,
      offset: clampOffset(block.text, reference.offset),
    }));
  }
  const references: DocxNoteReference[] = [];
  if (block.footnoteId) {
    references.push({ id: block.footnoteId, kind: "footnote", offset: block.text.length });
  }
  if (block.endnoteId) {
    references.push({ id: block.endnoteId, kind: "endnote", offset: block.text.length });
  }
  return references;
}

export function docxBlockWithTransformedAnchors(
  block: DocxBlock,
  start: number,
  end: number,
  insertedLength: number,
): Partial<DocxBlock> {
  const editStart = clampOffset(block.text, Math.min(start, end));
  const editEnd = clampOffset(block.text, Math.max(start, end));
  const commentRanges = docxCommentRanges(block)
    .map((range) => transformCommentRange(range, editStart, editEnd, insertedLength))
    .filter((range): range is DocxCommentRange => range !== null);
  const hyperlinks = docxHyperlinkRanges(block)
    .map((range) => transformHyperlinkRange(range, editStart, editEnd, insertedLength))
    .filter((range): range is DocxHyperlinkRange => range !== null);
  const noteReferences = docxNoteReferences(block).map((reference) => ({
    ...reference,
    offset: transformAnchorOffset(
      reference.offset,
      reference.affinity ?? "after",
      editStart,
      editEnd,
      insertedLength,
    ),
  }));
  const contentControls = block.contentControls?.map((control) => {
    if (control.start === undefined || control.end === undefined) return control;
    const nextStart = transformAnchorOffset(
      control.start,
      "before",
      editStart,
      editEnd,
      insertedLength,
    );
    const nextEnd = transformAnchorOffset(
      control.end,
      "before",
      editStart,
      editEnd,
      insertedLength,
    );
    return { ...control, start: nextStart, end: Math.max(nextStart, nextEnd) };
  });
  return {
    commentId: undefined,
    footnoteId: undefined,
    endnoteId: undefined,
    target: undefined,
    relationshipId: undefined,
    commentRanges,
    hyperlinks,
    noteReferences,
    contentControls,
  };
}

export function addDocxCommentRange(
  block: DocxBlock,
  range: TextRange,
  commentId: string,
): { block: DocxBlock } | { reason: string } {
  const start = clampOffset(block.text, Math.min(range.start, range.end));
  const end = clampOffset(block.text, Math.max(range.start, range.end));
  if (start === end) return { reason: "Select text before adding a comment" };
  const candidate: DocxCommentRange = { commentId, start, end };
  const current = docxCommentRanges(block).filter((item) => item.commentId !== commentId);
  const crossing = current.find((item) => rangesCross(item, candidate));
  if (crossing) {
    return {
      reason: `Comment #${crossing.commentId} crosses this selection; use a nested or disjoint range`,
    };
  }
  return {
    block: {
      ...block,
      commentId: undefined,
      commentRanges: [...current, candidate].sort(compareRanges),
    },
  };
}

export function setDocxHyperlinkRange(
  block: DocxBlock,
  range: TextRange,
  target: string | undefined,
): { block: DocxBlock } | { reason: string } {
  const start = clampOffset(block.text, Math.min(range.start, range.end));
  const end = clampOffset(block.text, Math.max(range.start, range.end));
  if (start === end) return { reason: "Select text before changing a link" };
  const remaining = docxHyperlinkRanges(block).flatMap((item) =>
    subtractRange(item, { start, end }),
  );
  const next = target
    ? [
        ...remaining,
        {
          id: nextHyperlinkId(block, remaining),
          start,
          end,
          target,
        } satisfies DocxHyperlinkRange,
      ]
    : remaining;
  return {
    block: {
      ...block,
      target: undefined,
      relationshipId: undefined,
      hyperlinks: coalesceHyperlinks(next.sort(compareRanges)),
    },
  };
}

export function splitDocxBlockAnchors(block: DocxBlock, offset: number) {
  const splitOffset = clampOffset(block.text, offset);
  const beforeComments: DocxCommentRange[] = [];
  const afterComments: DocxCommentRange[] = [];
  for (const range of docxCommentRanges(block)) {
    if (range.end <= splitOffset) {
      beforeComments.push(range);
    } else if (range.start >= splitOffset) {
      afterComments.push(shiftCommentRange(range, -splitOffset));
    } else {
      beforeComments.push({ ...range, end: splitOffset, endsHere: false });
      afterComments.push({
        ...range,
        start: 0,
        end: range.end - splitOffset,
        startsHere: false,
      });
    }
  }
  const beforeLinks: DocxHyperlinkRange[] = [];
  const afterLinks: DocxHyperlinkRange[] = [];
  for (const range of docxHyperlinkRanges(block)) {
    if (range.end <= splitOffset) {
      beforeLinks.push(range);
    } else if (range.start >= splitOffset) {
      afterLinks.push(shiftHyperlinkRange(range, -splitOffset));
    } else {
      beforeLinks.push({ ...range, end: splitOffset });
      afterLinks.push({ ...range, start: 0, end: range.end - splitOffset });
    }
  }
  const beforeNotes: DocxNoteReference[] = [];
  const afterNotes: DocxNoteReference[] = [];
  for (const reference of docxNoteReferences(block)) {
    if (
      reference.offset < splitOffset ||
      (reference.offset === splitOffset && (reference.affinity ?? "after") === "before")
    ) {
      beforeNotes.push(reference);
    } else {
      afterNotes.push({ ...reference, offset: reference.offset - splitOffset });
    }
  }
  return {
    before: anchorPatch(beforeComments, beforeLinks, beforeNotes),
    after: anchorPatch(afterComments, afterLinks, afterNotes),
  };
}

export function mergeDocxBlockAnchors(previous: DocxBlock, current: DocxBlock) {
  const offset = previous.text.length;
  const comments = coalesceCommentRanges([
    ...docxCommentRanges(previous),
    ...docxCommentRanges(current).map((range) => shiftCommentRange(range, offset)),
  ]);
  const hyperlinks = coalesceHyperlinks([
    ...docxHyperlinkRanges(previous),
    ...docxHyperlinkRanges(current).map((range) => shiftHyperlinkRange(range, offset)),
  ]);
  const notes = [
    ...docxNoteReferences(previous),
    ...docxNoteReferences(current).map((reference) => ({
      ...reference,
      offset: reference.offset + offset,
    })),
  ];
  return anchorPatch(comments, hyperlinks, notes);
}

export interface DocxAnchoredTextSegment {
  text: string;
  run: DocxRun;
  commentIds: string[];
  hyperlink?: DocxHyperlinkRange;
}

export function docxAnchoredTextSegments(block: DocxBlock, runs: DocxRun[]) {
  const comments = docxCommentRanges(block);
  const hyperlinks = docxHyperlinkRanges(block);
  const boundaries = new Set<number>([0, block.text.length]);
  comments.forEach((range) => {
    boundaries.add(range.start);
    boundaries.add(range.end);
  });
  hyperlinks.forEach((range) => {
    boundaries.add(range.start);
    boundaries.add(range.end);
  });
  let runOffset = 0;
  runs.forEach((run) => {
    boundaries.add(runOffset);
    runOffset += run.text.length;
    boundaries.add(runOffset);
  });
  const sorted = [...boundaries].sort((left, right) => left - right);
  const segments: DocxAnchoredTextSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end <= start) continue;
    const run = runAtOffset(runs, start) ?? { text: block.text.slice(start, end) };
    segments.push({
      text: block.text.slice(start, end),
      run,
      commentIds: comments
        .filter((range) => range.start <= start && range.end >= end)
        .map((range) => range.commentId),
      hyperlink: hyperlinks.find((range) => range.start <= start && range.end >= end),
    });
  }
  return segments;
}

function anchorPatch(
  commentRanges: DocxCommentRange[],
  hyperlinks: DocxHyperlinkRange[],
  noteReferences: DocxNoteReference[],
): Partial<DocxBlock> {
  return {
    commentId: undefined,
    footnoteId: undefined,
    endnoteId: undefined,
    target: undefined,
    relationshipId: undefined,
    commentRanges,
    hyperlinks,
    noteReferences,
  };
}

function transformCommentRange(
  range: DocxCommentRange,
  editStart: number,
  editEnd: number,
  insertedLength: number,
) {
  const start = transformAnchorOffset(
    range.start,
    range.startAffinity ?? "before",
    editStart,
    editEnd,
    insertedLength,
  );
  const end = transformAnchorOffset(
    range.end,
    range.endAffinity ?? "before",
    editStart,
    editEnd,
    insertedLength,
  );
  return end > start ? { ...range, start, end } : null;
}

function transformHyperlinkRange(
  range: DocxHyperlinkRange,
  editStart: number,
  editEnd: number,
  insertedLength: number,
) {
  const start = transformAnchorOffset(
    range.start,
    range.startAffinity ?? "before",
    editStart,
    editEnd,
    insertedLength,
  );
  const end = transformAnchorOffset(
    range.end,
    range.endAffinity ?? "before",
    editStart,
    editEnd,
    insertedLength,
  );
  return end > start ? { ...range, start, end } : null;
}

function transformAnchorOffset(
  offset: number,
  affinity: DocxTextAnchorAffinity,
  editStart: number,
  editEnd: number,
  insertedLength: number,
) {
  if (editStart === editEnd) {
    if (offset < editStart) return offset;
    if (offset > editStart) return offset + insertedLength;
    return affinity === "after" ? offset + insertedLength : offset;
  }
  const delta = insertedLength - (editEnd - editStart);
  if (offset < editStart) return offset;
  if (offset > editEnd) return offset + delta;
  if (offset === editStart) return editStart;
  if (offset === editEnd) return editStart + insertedLength;
  return affinity === "after" ? editStart + insertedLength : editStart;
}

function subtractRange(range: DocxHyperlinkRange, removed: TextRange) {
  if (range.end <= removed.start || range.start >= removed.end) return [range];
  const remaining: DocxHyperlinkRange[] = [];
  if (range.start < removed.start) remaining.push({ ...range, end: removed.start });
  if (range.end > removed.end) {
    remaining.push({ ...range, id: `${range.id}-right`, start: removed.end });
  }
  return remaining;
}

function coalesceCommentRanges(ranges: DocxCommentRange[]) {
  const result: DocxCommentRange[] = [];
  for (const range of ranges.sort(compareRanges)) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.commentId === range.commentId &&
      previous.end === range.start &&
      previous.endsHere === false &&
      range.startsHere === false
    ) {
      result[result.length - 1] = {
        ...previous,
        end: range.end,
        endsHere: range.endsHere,
        endAffinity: range.endAffinity,
      };
    } else {
      result.push(range);
    }
  }
  return result;
}

function coalesceHyperlinks(ranges: DocxHyperlinkRange[]) {
  const result: DocxHyperlinkRange[] = [];
  for (const range of ranges.sort(compareRanges)) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.end === range.start &&
      previous.target === range.target &&
      previous.relationshipId === range.relationshipId
    ) {
      result[result.length - 1] = { ...previous, end: range.end };
    } else {
      result.push(range);
    }
  }
  return result;
}

function shiftCommentRange(range: DocxCommentRange, delta: number) {
  return { ...range, start: range.start + delta, end: range.end + delta };
}

function shiftHyperlinkRange(range: DocxHyperlinkRange, delta: number) {
  return { ...range, start: range.start + delta, end: range.end + delta };
}

function clampCommentRange(block: DocxBlock) {
  return (range: DocxCommentRange): DocxCommentRange => ({
    ...range,
    start: clampOffset(block.text, range.start),
    end: clampOffset(block.text, Math.max(range.start, range.end)),
  });
}

function clampHyperlinkRange(block: DocxBlock) {
  return (range: DocxHyperlinkRange): DocxHyperlinkRange => ({
    ...range,
    start: clampOffset(block.text, range.start),
    end: clampOffset(block.text, Math.max(range.start, range.end)),
  });
}

function clampOffset(text: string, offset: number) {
  return Math.max(0, Math.min(text.length, Number.isFinite(offset) ? offset : 0));
}

function rangesCross(left: TextRange, right: TextRange) {
  return (
    (left.start < right.start && right.start < left.end && left.end < right.end) ||
    (right.start < left.start && left.start < right.end && right.end < left.end)
  );
}

function compareRanges(left: TextRange, right: TextRange) {
  return left.start - right.start || right.end - left.end;
}

function nextHyperlinkId(block: DocxBlock, ranges: DocxHyperlinkRange[]) {
  const used = new Set(ranges.map((range) => range.id));
  let index = 1;
  while (used.has(`${block.id}-link-${index}`)) index += 1;
  return `${block.id}-link-${index}`;
}

function runAtOffset(runs: DocxRun[], target: number) {
  let offset = 0;
  for (const run of runs) {
    if (target >= offset && target < offset + run.text.length) return run;
    offset += run.text.length;
  }
  return runs.at(-1);
}
