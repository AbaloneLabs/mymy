import type { CSSProperties } from "react";
import { builtInFontFamilies } from "../shared/fonts";
import type { DocxBlock, DocxRun, DocxStyle } from "../shared/models";
import { headingFontSize, isDocxTextBlock, twipsToCssPixels } from "./docxEditorUtils";
import {
  docxBlockWithTransformedAnchors,
  mergeDocxBlockAnchors,
  splitDocxBlockAnchors,
} from "./docxTextAnchors";

type DocxInlineStyleKey = Exclude<keyof DocxRun, "text">;
type DocxInlineStylePatch = Partial<Pick<DocxRun, DocxInlineStyleKey>>;

const DOCX_INLINE_STYLE_KEYS: DocxInlineStyleKey[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "verticalAlign",
  "fontFamily",
  "fontSize",
  "color",
  "highlight",
];

const DOCX_STYLE_INHERITED_KEYS = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "verticalAlign",
  "fontFamily",
  "fontSize",
  "color",
  "highlight",
  "align",
] as const;

/**
 * DOCX run metadata remains authoritative while text mutations split and merge
 * the affected ranges. Browser fallback and IME paths derive one contiguous
 * replacement from the old and new text so unchanged neighboring runs are not
 * flattened merely because a specific `beforeinput` type was unavailable.
 */
export function docxRunsText(runs: DocxRun[] | undefined) {
  return runs?.map((run) => run.text).join("") ?? "";
}

export function docxMergeRuns(runs: DocxRun[]) {
  return mergeAdjacentDocxRuns(runs.filter((run) => run.text.length > 0));
}

export function docxRenderableRuns(block: DocxBlock) {
  if (!isDocxTextBlock(block) || !block.runs?.length) return null;
  return docxRunsText(block.runs) === block.text ? block.runs : null;
}

export function docxTextEditPatch(
  block: DocxBlock,
  text: string,
): Partial<DocxBlock> {
  return docxRunTextDiffPatch(block, text) ?? { text };
}

export function docxRunTextDiffPatch(block: DocxBlock, nextText: string) {
  if (!isDocxTextBlock(block)) return null;
  if (block.text === nextText) return { ...block };
  let prefix = 0;
  const prefixLimit = Math.min(block.text.length, nextText.length);
  while (prefix < prefixLimit && block.text[prefix] === nextText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < block.text.length - prefix &&
    suffix < nextText.length - prefix &&
    block.text[block.text.length - 1 - suffix] ===
      nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return docxRunTextInputPatch(
    block,
    prefix,
    block.text.length - suffix,
    nextText.slice(prefix, nextText.length - suffix),
  );
}

export function isDocxInlineStylePatch(patch: Partial<DocxBlock>) {
  const keys = Object.keys(patch);
  return (
    keys.length > 0 &&
    keys.every((key) =>
      DOCX_INLINE_STYLE_KEYS.includes(key as DocxInlineStyleKey),
    )
  );
}

export function applyDocxInlineStyleRange(
  block: DocxBlock,
  start: number,
  end: number,
  patch: DocxInlineStylePatch,
) {
  if (!isDocxTextBlock(block) || start === end) return null;
  const rangeStart = Math.max(0, Math.min(block.text.length, start));
  const rangeEnd = Math.max(rangeStart, Math.min(block.text.length, end));
  if (rangeStart === rangeEnd) return null;
  return {
    ...block,
    runs: docxMergeRuns(
      splitDocxRuns(block).flatMap((run, index, runs) => {
        const runStart = runs
          .slice(0, index)
          .reduce((offset, item) => offset + item.text.length, 0);
        const runEnd = runStart + run.text.length;
        if (runEnd <= rangeStart || runStart >= rangeEnd) return [run];
        const beforeLength = Math.max(0, rangeStart - runStart);
        const afterStart = Math.max(beforeLength, rangeEnd - runStart);
        const nextRuns: DocxRun[] = [];
        if (beforeLength > 0) {
          nextRuns.push({ ...run, text: run.text.slice(0, beforeLength) });
        }
        nextRuns.push({
          ...run,
          ...patch,
          text: run.text.slice(beforeLength, afterStart),
        });
        if (afterStart < run.text.length) {
          nextRuns.push({ ...run, text: run.text.slice(afterStart) });
        }
        return nextRuns.filter((item) => item.text.length > 0);
      }),
    ),
  };
}

export function replaceDocxRunRange(
  block: DocxBlock,
  start: number,
  end: number,
  replacementRuns: DocxRun[],
) {
  if (!isDocxTextBlock(block)) return null;
  const rangeStart = Math.max(0, Math.min(block.text.length, start));
  const rangeEnd = Math.max(rangeStart, Math.min(block.text.length, end));
  const { before, after } = splitDocxRunsAroundRange(block, rangeStart, rangeEnd);
  const runs = docxMergeRuns([...before, ...replacementRuns, ...after]);
  const text = docxRunsText(runs);
  return {
    ...block,
    ...docxBlockWithTransformedAnchors(
      block,
      rangeStart,
      rangeEnd,
      docxRunsText(replacementRuns).length,
    ),
    text,
    runs: runs.length > 0 ? runs : undefined,
  };
}

export function docxRunTextInputPatch(
  block: DocxBlock,
  start: number,
  end: number,
  text: string,
) {
  if (!isDocxTextBlock(block)) return null;
  const replacementRuns = text
    ? [docxInsertionRun(block, start, text, end > start)]
    : [];
  return replaceDocxRunRange(block, start, end, replacementRuns);
}

export function splitDocxRunsAroundRange(
  block: DocxBlock,
  start: number,
  end: number,
) {
  const rangeStart = Math.max(0, Math.min(block.text.length, start));
  const rangeEnd = Math.max(rangeStart, Math.min(block.text.length, end));
  const before: DocxRun[] = [];
  const after: DocxRun[] = [];
  let offset = 0;
  for (const run of splitDocxRuns(block)) {
    const runStart = offset;
    const runEnd = runStart + run.text.length;
    offset = runEnd;
    if (runEnd <= rangeStart) {
      before.push({ ...run });
      continue;
    }
    if (runStart >= rangeEnd) {
      after.push({ ...run });
      continue;
    }
    if (runStart < rangeStart) {
      before.push({
        ...run,
        text: run.text.slice(0, rangeStart - runStart),
      });
    }
    if (runEnd > rangeEnd) {
      after.push({
        ...run,
        text: run.text.slice(rangeEnd - runStart),
      });
    }
  }
  return {
    before: docxMergeRuns(before),
    after: docxMergeRuns(after),
  };
}

export function splitDocxTextBlockRuns(
  block: DocxBlock,
  offset: number,
  nextId: string,
): { before: DocxBlock; after: DocxBlock } | { reason: string } | null {
  if (!isDocxTextBlock(block)) return null;
  const reason = docxTextStructureBlockReason(block);
  if (reason) return { reason };
  const safeOffset = Math.max(0, Math.min(block.text.length, offset));
  const { before, after } = splitDocxRunsAroundRange(
    block,
    safeOffset,
    safeOffset,
  );
  const anchors = splitDocxBlockAnchors(block, safeOffset);
  const nextIsParagraph = block.type === "heading";
  return {
    before: {
      ...block,
      ...anchors.before,
      text: docxRunsText(before),
      runs: before.length > 0 ? before : undefined,
    },
    after: {
      ...block,
      ...anchors.after,
      id: nextId,
      type: nextIsParagraph ? ("paragraph" as const) : block.type,
      text: docxRunsText(after),
      runs: after.length > 0 ? after : undefined,
      headingLevel: nextIsParagraph ? undefined : block.headingLevel,
      paragraphStyleId: nextIsParagraph ? undefined : block.paragraphStyleId,
      paragraphStyleName: nextIsParagraph
        ? undefined
        : block.paragraphStyleName,
      fontSize: nextIsParagraph ? "14" : block.fontSize,
      sourceXml: undefined,
    },
  };
}

export function mergeDocxTextBlockRuns(
  previous: DocxBlock,
  current: DocxBlock,
): { block: DocxBlock } | { reason: string } {
  if (!isDocxTextBlock(previous) || !isDocxTextBlock(current)) {
    return { reason: "Only text paragraphs can be merged" };
  }
  const reason =
    docxTextStructureBlockReason(previous) ??
    docxTextStructureBlockReason(current);
  if (reason) return { reason };
  if (previous.target !== current.target) {
    return {
      reason: "Paragraphs with different hyperlink targets cannot be merged safely",
    };
  }
  const runs = docxMergeRuns([
    ...splitDocxRuns(previous),
    ...splitDocxRuns(current),
  ]);
  return {
    block: {
      ...previous,
      ...mergeDocxBlockAnchors(previous, current),
      text: docxRunsText(runs),
      runs: runs.length > 0 ? runs : undefined,
    },
  };
}

export function docxTextStructureBlockReason(block: DocxBlock) {
  if (block.bookmarkId || block.bookmarkName) {
    return "Bookmarks need range anchors before split or merge";
  }
  if (block.commentId && !block.commentRanges) {
    return "Comments need range anchors before split or merge";
  }
  if ((block.footnoteId || block.endnoteId) && !block.noteReferences) {
    return "Note references need range anchors before split or merge";
  }
  if (block.fields?.length) return "Fields need range anchors before split or merge";
  if (block.contentControls?.length) {
    return "Content controls need stable range anchors before split or merge";
  }
  if (block.revisions?.length) {
    return "Revision markup needs range anchors before split or merge";
  }
  return null;
}

export function docxTextEditingBlockReason(block: DocxBlock) {
  if ((block.target || block.relationshipId) && !block.hyperlinks) {
    return "Hyperlinked paragraph text needs run-level relationship anchors";
  }
  return docxTextStructureBlockReason(block);
}

export function toggleDocxInlineBooleanRange(
  block: DocxBlock,
  start: number,
  end: number,
  key: Extract<
    DocxInlineStyleKey,
    "bold" | "italic" | "underline" | "strikethrough"
  >,
) {
  const runs = runsIntersectingRange(block, start, end);
  if (runs.length === 0) return null;
  const nextValue = !runs.every((run) => run[key] === true);
  return applyDocxInlineStyleRange(block, start, end, { [key]: nextValue });
}

export function docxStyleForBlock(
  styles: DocxStyle[] | undefined,
  block: DocxBlock,
) {
  const styleId =
    block.paragraphStyleId ??
    (block.type === "heading" ? `Heading${block.headingLevel ?? 1}` : undefined);
  if (!styleId) return undefined;
  return resolveDocxStyle(styles, styleId);
}

export function resolveDocxStyle(
  styles: DocxStyle[] | undefined,
  styleId: string,
  visited = new Set<string>(),
): DocxStyle | undefined {
  const style = styles?.find((item) => item.id === styleId);
  if (!style || !style.basedOn || visited.has(style.id)) return style;
  visited.add(style.id);
  const base = resolveDocxStyle(styles, style.basedOn, visited);
  if (!base) return style;
  const merged: DocxStyle = { ...base, ...style };
  for (const key of DOCX_STYLE_INHERITED_KEYS) {
    if (style[key] === undefined && base[key] !== undefined) {
      merged[key] = base[key] as never;
    }
  }
  return merged;
}

export function docxTextBlockStyle(
  block: DocxBlock,
  paragraphStyle?: DocxStyle,
): CSSProperties {
  const effectiveBold =
    block.bold ?? paragraphStyle?.bold ?? block.type === "heading";
  const effectiveItalic = block.italic ?? paragraphStyle?.italic ?? false;
  const effectiveUnderline =
    block.underline ?? paragraphStyle?.underline ?? Boolean(block.target);
  const effectiveStrikethrough =
    block.strikethrough ?? paragraphStyle?.strikethrough ?? false;
  return {
    fontFamily: block.fontFamily || paragraphStyle?.fontFamily || builtInFontFamilies[0],
    fontSize: `${
      block.fontSize ??
      paragraphStyle?.fontSize ??
      (block.type === "heading" ? headingFontSize(block.headingLevel ?? 1) : "14")
    }px`,
    fontWeight: effectiveBold ? 700 : 400,
    fontStyle: effectiveItalic ? "italic" : undefined,
    verticalAlign:
      block.verticalAlign === "superscript"
        ? "super"
        : block.verticalAlign === "subscript"
          ? "sub"
          : undefined,
    textDecorationLine: [
      effectiveUnderline ? "underline" : "",
      effectiveStrikethrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" "),
    color: block.target
      ? (block.color ?? paragraphStyle?.color ?? "#2563eb")
      : block.color ?? paragraphStyle?.color,
    textAlign: block.align ?? paragraphStyle?.align ?? "left",
    display: block.listKind ? "list-item" : undefined,
    listStyleType: docxCssListStyleType(block),
    listStylePosition: block.listKind ? "outside" : undefined,
    marginLeft: block.listKind ? "1.5rem" : undefined,
    paddingLeft: block.indentLeft ? `${twipsToCssPixels(block.indentLeft)}px` : undefined,
    lineHeight: block.lineSpacing ? String(block.lineSpacing / 240) : undefined,
    marginTop: block.spacingBefore ? `${twipsToCssPixels(block.spacingBefore)}px` : undefined,
    marginBottom: block.spacingAfter ? `${twipsToCssPixels(block.spacingAfter)}px` : undefined,
    backgroundColor: block.highlight ?? paragraphStyle?.highlight,
  };
}

function docxCssListStyleType(block: DocxBlock) {
  if (block.listKind === "bullet") {
    return ["disc", "circle", "square"][Math.min(block.listLevel ?? 0, 2)] ?? "disc";
  }
  if (block.listKind === "number") {
    return ["decimal", "lower-alpha", "lower-roman"][
      Math.min(block.listLevel ?? 0, 2)
    ] ?? "decimal";
  }
  return undefined;
}

export function docxRunStyle(run: DocxRun): CSSProperties {
  const textDecorationLine =
    [
      run.underline ? "underline" : "",
      run.strikethrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ") ||
    (run.underline === false || run.strikethrough === false ? "none" : undefined);
  return {
    fontFamily: run.fontFamily,
    fontSize: run.fontSize ? `${run.fontSize}px` : undefined,
    fontWeight: run.bold === false ? 400 : run.bold ? 700 : undefined,
    fontStyle: run.italic === false ? "normal" : run.italic ? "italic" : undefined,
    verticalAlign:
      run.verticalAlign === "superscript"
        ? "super"
        : run.verticalAlign === "subscript"
          ? "sub"
          : undefined,
    textDecorationLine,
    color: run.color,
    backgroundColor: run.highlight,
  };
}

export function splitDocxRuns(block: DocxBlock) {
  const existingRuns = docxRenderableRuns(block);
  if (existingRuns) return existingRuns.map((run) => ({ ...run }));
  return [baseDocxRun(block, block.text)];
}

function baseDocxRun(block: DocxBlock, text: string): DocxRun {
  const run: DocxRun = { text };
  for (const key of DOCX_INLINE_STYLE_KEYS) {
    const value = block[key];
    if (value !== undefined) {
      (run as Record<DocxInlineStyleKey, DocxRun[DocxInlineStyleKey]>)[key] =
        value;
    }
  }
  return run;
}

function docxInsertionRun(
  block: DocxBlock,
  offset: number,
  text: string,
  preferFollowingRun = false,
) {
  const safeOffset = Math.max(0, Math.min(block.text.length, offset));
  const runs = splitDocxRuns(block);
  let cursor = 0;
  let fallback = runs[0] ?? baseDocxRun(block, "");
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    if (
      safeOffset >= runStart &&
      (preferFollowingRun ? safeOffset < runEnd : safeOffset <= runEnd)
    ) {
      fallback = run;
      break;
    }
    fallback = run;
    cursor = runEnd;
  }
  return { ...fallback, text };
}

function runsIntersectingRange(block: DocxBlock, start: number, end: number) {
  let offset = 0;
  return splitDocxRuns(block).filter((run) => {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    return runEnd > start && runStart < end;
  });
}

function mergeAdjacentDocxRuns(runs: DocxRun[]) {
  return runs.reduce<DocxRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous && sameDocxRunStyle(previous, run)) {
      previous.text += run.text;
    } else {
      merged.push({ ...run });
    }
    return merged;
  }, []);
}

function sameDocxRunStyle(left: DocxRun, right: DocxRun) {
  return DOCX_INLINE_STYLE_KEYS.every((key) => left[key] === right[key]);
}
