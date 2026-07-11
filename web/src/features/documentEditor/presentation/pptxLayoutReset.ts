import type { PptxLayout, PptxSlide, PptxText } from "../shared/models";
import { nextPptxTextId } from "./pptxEditorUtils";

export type PptxLayoutResetPreview = {
  matchedPlaceholderCount: number;
  createdPlaceholderCount: number;
  preservedObjectCount: number;
};

/**
 * Layout reset is an inheritance operation, not collection replacement. The
 * current placeholder owns user-entered text and package identity; the layout
 * contributes only inherited geometry and presentation. Ordinary text boxes
 * are deliberately outside the mapping and therefore survive reset.
 */
export function resetPptxSlideToLayout(
  slide: PptxSlide,
  layout: PptxLayout,
): { slide: PptxSlide; preview: PptxLayoutResetPreview } {
  const layoutPlaceholders = layout.placeholderTexts ?? [];
  const currentPlaceholders = slide.texts.filter((text) => text.placeholderType);
  const ordinaryTexts = slide.texts.filter((text) => !text.placeholderType);
  const usedCurrentIds = new Set<string>();
  const usedTextIds = [...slide.texts];
  let matchedPlaceholderCount = 0;

  const placeholders = layoutPlaceholders.map((layoutPlaceholder) => {
    const current = findMatchingPlaceholder(
      currentPlaceholders,
      usedCurrentIds,
      layoutPlaceholder,
    );
    if (current) {
      usedCurrentIds.add(current.id);
      matchedPlaceholderCount += 1;
      return {
        ...layoutPlaceholder,
        id: current.id,
        shapeId: current.shapeId,
        text: current.text,
        textIndex: current.textIndex,
      };
    }
    const id = nextPptxTextId(usedTextIds);
    const next = {
      ...layoutPlaceholder,
      id,
      shapeId: undefined,
      groupShapeId: undefined,
      textIndex: undefined,
    };
    usedTextIds.push(next);
    return next;
  });

  const unmatchedCurrent = currentPlaceholders.filter(
    (placeholder) => !usedCurrentIds.has(placeholder.id),
  );
  return {
    slide: {
      ...slide,
      texts: [...ordinaryTexts, ...unmatchedCurrent, ...placeholders],
    },
    preview: {
      matchedPlaceholderCount,
      createdPlaceholderCount: placeholders.length - matchedPlaceholderCount,
      preservedObjectCount:
        ordinaryTexts.length +
        unmatchedCurrent.length +
        (slide.shapes?.length ?? 0) +
        (slide.images?.length ?? 0) +
        (slide.tables?.length ?? 0) +
        (slide.charts?.length ?? 0) +
        (slide.media?.length ?? 0),
    },
  };
}

function findMatchingPlaceholder(
  currentPlaceholders: PptxText[],
  usedCurrentIds: ReadonlySet<string>,
  layoutPlaceholder: PptxText,
) {
  return currentPlaceholders.find(
    (placeholder) =>
      !usedCurrentIds.has(placeholder.id) &&
      placeholder.placeholderType === layoutPlaceholder.placeholderType,
  );
}
