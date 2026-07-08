import type { PptxModel } from "../shared/models";
import {
  derivePptxEditorSelection,
  pptxSelectionBoxBounds,
} from "./pptxSelection";
import type {
  PptxSelectionBox,
  PptxSelectionKey,
} from "./pptxSelection";

export function derivePptxEditorState({
  model,
  preferredSlideId,
  activeTextId,
  activeShapeId,
  activeImageId,
  activeTableId,
  activeChartId,
  selectedObjectKeys,
  presentingIndex,
  selectionBox,
}: {
  model: PptxModel;
  preferredSlideId: string | null;
  activeTextId: string | null;
  activeShapeId: string | null;
  activeImageId: string | null;
  activeTableId: string | null;
  activeChartId: string | null;
  selectedObjectKeys: PptxSelectionKey[];
  presentingIndex: number | null;
  selectionBox: PptxSelectionBox | null;
}) {
  const slide =
    model.slides.find((item) => item.id === preferredSlideId) ?? model.slides[0];
  const slideIndex = slide
    ? Math.max(0, model.slides.findIndex((item) => item.id === slide.id))
    : 0;
  const presentingSlide =
    presentingIndex === null ? null : model.slides[presentingIndex] ?? null;
  const selection = derivePptxEditorSelection({
    slide,
    activeTextId,
    activeShapeId,
    activeImageId,
    activeTableId,
    activeChartId,
    selectedObjectKeys,
  });
  const activeTheme =
    (slide?.layoutThemePath
      ? model.themes?.find((theme) => theme.path === slide.layoutThemePath)
      : undefined) ?? model.themes?.[0];
  const selectionBoxBounds = selectionBox
    ? pptxSelectionBoxBounds(selectionBox)
    : null;

  return {
    activeTheme,
    presentingSlide,
    selectionBoxBounds,
    slide,
    slideIndex,
    ...selection,
  };
}
