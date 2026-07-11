import {
  rangeToA1,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import type {
  XlsxComment,
  XlsxConditionalFormatting,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxMergedRange,
} from "../shared/models";

export function nonOverlappingMergedRanges(
  ranges: XlsxMergedRange[],
  selection: NormalizedCellRange,
) {
  return ranges.filter((range) => {
    const parsed = xlsxRangeFromRef(range.ref);
    return parsed ? !rangesOverlap(parsed, selection) : false;
  });
}

export function xlsxDataValidationForRange(
  validations: XlsxDataValidation[] | undefined,
  selection: NormalizedCellRange,
) {
  return validations?.find((validation) =>
    xlsxSqrefRanges(validation.sqref).some((range) =>
      rangesOverlap(range, selection),
    ),
  );
}

export function xlsxCellHasDataValidation(
  validations: XlsxDataValidation[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    validations?.some((validation) =>
      xlsxSqrefRanges(validation.sqref).some((range) =>
        rangeContainsCell(range, row, column),
      ),
    ),
  );
}

export function xlsxHyperlinkForRange(
  hyperlinks: XlsxHyperlink[] | undefined,
  selection: NormalizedCellRange,
) {
  return hyperlinks?.find((hyperlink) =>
    xlsxSqrefRanges(hyperlink.ref).some((range) =>
      rangesOverlap(range, selection),
    ),
  );
}

export function xlsxCellHasHyperlink(
  hyperlinks: XlsxHyperlink[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    hyperlinks?.some((hyperlink) =>
      xlsxSqrefRanges(hyperlink.ref).some((range) =>
        rangeContainsCell(range, row, column),
      ),
    ),
  );
}

export function nonOverlappingHyperlinks(
  hyperlinks: XlsxHyperlink[],
  selection: NormalizedCellRange,
) {
  return hyperlinks.flatMap((hyperlink) =>
    referencesWithoutSelection(hyperlink.ref, selection).map((ref) => ({
      ...hyperlink,
      ref,
    })),
  );
}

export function xlsxCommentForRange(
  comments: XlsxComment[] | undefined,
  selection: NormalizedCellRange,
) {
  return comments?.find((comment) =>
    xlsxSqrefRanges(comment.ref).some((range) =>
      rangesOverlap(range, selection),
    ),
  );
}

export function xlsxCellHasComment(
  comments: XlsxComment[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    comments?.some((comment) =>
      xlsxSqrefRanges(comment.ref).some((range) =>
        rangeContainsCell(range, row, column),
      ),
    ),
  );
}

export function nonOverlappingComments(
  comments: XlsxComment[],
  selection: NormalizedCellRange,
) {
  return comments.filter((comment) => {
    const range = xlsxRangeFromRef(comment.ref);
    return !range || !rangesOverlap(range, selection);
  });
}

export function nonOverlappingDataValidations(
  validations: XlsxDataValidation[],
  selection: NormalizedCellRange,
) {
  return validations
    .map((validation) => {
      const sqref = referenceWithoutSelection(validation.sqref, selection);
      return sqref ? { ...validation, sqref } : null;
    })
    .filter((validation): validation is XlsxDataValidation => validation !== null);
}

export function xlsxConditionalRuleForRange(
  formattings: XlsxConditionalFormatting[] | undefined,
  selection: NormalizedCellRange,
) {
  return formattings
    ?.find((formatting) =>
      xlsxSqrefRanges(formatting.sqref).some((range) =>
        rangesOverlap(range, selection),
      ),
    )
    ?.rules.find((rule) => Boolean(rule.type || rule.sourceXml));
}

export function nonOverlappingConditionalFormattings(
  formattings: XlsxConditionalFormatting[],
  selection: NormalizedCellRange,
) {
  return formattings
    .map((formatting) => {
      const sqref = referenceWithoutSelection(formatting.sqref, selection);
      return sqref ? { ...formatting, sqref } : null;
    })
    .filter(
      (formatting): formatting is XlsxConditionalFormatting =>
        formatting !== null,
    );
}

export function shiftXlsxConditionalFormattingsForRowInsert(
  formattings: XlsxConditionalFormatting[] | undefined,
  insertAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) =>
    shiftRangeForRowInsert(range, insertAt),
  );
}

export function shiftXlsxConditionalFormattingsForColumnInsert(
  formattings: XlsxConditionalFormatting[] | undefined,
  insertAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) =>
    shiftRangeForColumnInsert(range, insertAt),
  );
}

export function shiftXlsxConditionalFormattingsForRowDelete(
  formattings: XlsxConditionalFormatting[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) =>
    shiftRangeForRowDelete(range, deleteAt),
  );
}

export function shiftXlsxConditionalFormattingsForColumnDelete(
  formattings: XlsxConditionalFormatting[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) =>
    shiftRangeForColumnDelete(range, deleteAt),
  );
}

export function shiftXlsxDataValidationsForRowInsert(
  validations: XlsxDataValidation[] | undefined,
  insertAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) =>
    shiftRangeForRowInsert(range, insertAt),
  );
}

export function shiftXlsxDataValidationsForColumnInsert(
  validations: XlsxDataValidation[] | undefined,
  insertAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) =>
    shiftRangeForColumnInsert(range, insertAt),
  );
}

export function shiftXlsxDataValidationsForRowDelete(
  validations: XlsxDataValidation[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) =>
    shiftRangeForRowDelete(range, deleteAt),
  );
}

export function shiftXlsxDataValidationsForColumnDelete(
  validations: XlsxDataValidation[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) =>
    shiftRangeForColumnDelete(range, deleteAt),
  );
}

export function shiftXlsxHyperlinksForRowInsert(
  hyperlinks: XlsxHyperlink[] | undefined,
  insertAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) =>
    shiftRangeForRowInsert(range, insertAt),
  );
}

export function shiftXlsxHyperlinksForColumnInsert(
  hyperlinks: XlsxHyperlink[] | undefined,
  insertAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) =>
    shiftRangeForColumnInsert(range, insertAt),
  );
}

export function shiftXlsxHyperlinksForRowDelete(
  hyperlinks: XlsxHyperlink[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) =>
    shiftRangeForRowDelete(range, deleteAt),
  );
}

export function shiftXlsxHyperlinksForColumnDelete(
  hyperlinks: XlsxHyperlink[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) =>
    shiftRangeForColumnDelete(range, deleteAt),
  );
}

export function shiftXlsxCommentsForRowInsert(
  comments: XlsxComment[] | undefined,
  insertAt: number,
) {
  return shiftXlsxComments(comments, (range) =>
    shiftRangeForRowInsert(range, insertAt),
  );
}

export function shiftXlsxCommentsForColumnInsert(
  comments: XlsxComment[] | undefined,
  insertAt: number,
) {
  return shiftXlsxComments(comments, (range) =>
    shiftRangeForColumnInsert(range, insertAt),
  );
}

export function shiftXlsxCommentsForRowDelete(
  comments: XlsxComment[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxComments(comments, (range) =>
    shiftRangeForRowDelete(range, deleteAt),
  );
}

export function shiftXlsxCommentsForColumnDelete(
  comments: XlsxComment[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxComments(comments, (range) =>
    shiftRangeForColumnDelete(range, deleteAt),
  );
}

export function shiftXlsxRangeForRowInsert(
  reference: string | undefined,
  insertAt: number,
) {
  return shiftXlsxRange(reference, (range) => shiftRangeForRowInsert(range, insertAt));
}

export function shiftXlsxRangeForColumnInsert(
  reference: string | undefined,
  insertAt: number,
) {
  return shiftXlsxRange(reference, (range) =>
    shiftRangeForColumnInsert(range, insertAt),
  );
}

export function shiftXlsxRangeForRowDelete(
  reference: string | undefined,
  deleteAt: number,
) {
  return shiftXlsxRange(reference, (range) => shiftRangeForRowDelete(range, deleteAt));
}

export function shiftXlsxRangeForColumnDelete(
  reference: string | undefined,
  deleteAt: number,
) {
  return shiftXlsxRange(reference, (range) =>
    shiftRangeForColumnDelete(range, deleteAt),
  );
}

export function xlsxSqrefRanges(sqref: string) {
  return sqref
    .split(/\s+/)
    .map((reference) => xlsxRangeFromRef(reference))
    .filter((range): range is NormalizedCellRange => range !== null);
}

export function rangesOverlap(left: NormalizedCellRange, right: NormalizedCellRange) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

/**
 * Remove only the selected cells from a possibly multi-area OOXML reference.
 * Metadata editors commonly replace one rectangular selection inside a much
 * larger validation or formatting region. Dropping the entire source entry
 * would make an apparently local action erase unrelated behavior, so every
 * intersected rectangle is partitioned into the remaining disjoint strips.
 * Opaque reference tokens are retained because we cannot safely conclude that
 * they overlap; package validation can then preserve or report them.
 */
function referenceWithoutSelection(
  reference: string,
  selection: NormalizedCellRange,
) {
  const remaining = referencesWithoutSelection(reference, selection);
  return remaining.length > 0 ? remaining.join(" ") : null;
}

function referencesWithoutSelection(
  reference: string,
  selection: NormalizedCellRange,
) {
  return reference.trim().split(/\s+/).filter(Boolean).flatMap((token) => {
    const range = xlsxRangeFromRef(token);
    if (!range) return [token];
    return subtractRange(range, selection).map(rangeToA1);
  });
}

function subtractRange(
  source: NormalizedCellRange,
  removed: NormalizedCellRange,
) {
  if (!rangesOverlap(source, removed)) return [source];
  const intersection = {
    top: Math.max(source.top, removed.top),
    right: Math.min(source.right, removed.right),
    bottom: Math.min(source.bottom, removed.bottom),
    left: Math.max(source.left, removed.left),
  };
  const remaining: NormalizedCellRange[] = [];
  if (source.top < intersection.top) {
    remaining.push({
      top: source.top,
      right: source.right,
      bottom: intersection.top - 1,
      left: source.left,
    });
  }
  if (intersection.bottom < source.bottom) {
    remaining.push({
      top: intersection.bottom + 1,
      right: source.right,
      bottom: source.bottom,
      left: source.left,
    });
  }
  if (source.left < intersection.left) {
    remaining.push({
      top: intersection.top,
      right: intersection.left - 1,
      bottom: intersection.bottom,
      left: source.left,
    });
  }
  if (intersection.right < source.right) {
    remaining.push({
      top: intersection.top,
      right: source.right,
      bottom: intersection.bottom,
      left: intersection.right + 1,
    });
  }
  return remaining;
}

function rangeContainsCell(range: NormalizedCellRange, row: number, column: number) {
  return (
    row >= range.top &&
    row <= range.bottom &&
    column >= range.left &&
    column <= range.right
  );
}

function shiftXlsxConditionalFormattings(
  formattings: XlsxConditionalFormatting[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (formattings ?? [])
    .map((formatting) => {
      const ranges = xlsxSqrefRanges(formatting.sqref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...formatting, sqref: ranges.map(rangeToA1).join(" ") };
    })
    .filter(
      (formatting): formatting is XlsxConditionalFormatting =>
        formatting !== null,
    );
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxDataValidations(
  validations: XlsxDataValidation[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (validations ?? [])
    .map((validation) => {
      const ranges = xlsxSqrefRanges(validation.sqref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...validation, sqref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((validation): validation is XlsxDataValidation => validation !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxHyperlinks(
  hyperlinks: XlsxHyperlink[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (hyperlinks ?? [])
    .map((hyperlink) => {
      const ranges = xlsxSqrefRanges(hyperlink.ref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...hyperlink, ref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((hyperlink): hyperlink is XlsxHyperlink => hyperlink !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxComments(
  comments: XlsxComment[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (comments ?? [])
    .map((comment) => {
      const ranges = xlsxSqrefRanges(comment.ref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...comment, ref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((comment): comment is XlsxComment => comment !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxRange(
  reference: string | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  if (!reference) return undefined;
  const shifted = xlsxRangeFromRef(reference);
  if (!shifted) return undefined;
  const next = mapRange(shifted);
  return next ? rangeToA1(next) : undefined;
}

function shiftRangeForRowInsert(range: NormalizedCellRange, insertAt: number) {
  if (range.top >= insertAt) {
    return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
  }
  if (range.bottom >= insertAt) {
    return { ...range, bottom: range.bottom + 1 };
  }
  return range;
}

function shiftRangeForColumnInsert(range: NormalizedCellRange, insertAt: number) {
  if (range.left >= insertAt) {
    return { ...range, left: range.left + 1, right: range.right + 1 };
  }
  if (range.right >= insertAt) {
    return { ...range, right: range.right + 1 };
  }
  return range;
}

function shiftRangeForRowDelete(range: NormalizedCellRange, deleteAt: number) {
  if (range.bottom < deleteAt) return range;
  if (range.top > deleteAt) {
    return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
  }
  if (range.top === range.bottom) return null;
  return { ...range, bottom: range.bottom - 1 };
}

function shiftRangeForColumnDelete(range: NormalizedCellRange, deleteAt: number) {
  if (range.right < deleteAt) return range;
  if (range.left > deleteAt) {
    return { ...range, left: range.left - 1, right: range.right - 1 };
  }
  if (range.left === range.right) return null;
  return { ...range, right: range.right - 1 };
}
