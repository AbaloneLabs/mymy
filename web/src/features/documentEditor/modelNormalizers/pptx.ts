import type {
  PptxLayout,
  PptxMaster,
  PptxModel,
  PptxTableStyle,
  PptxTheme,
} from "../shared/models";
import { isRecord, numericField } from "./shared";
import {
  normalizePptxLayout,
  normalizePptxMaster,
  normalizePptxTableStyle,
  normalizePptxTheme,
} from "./pptx/metadata";
import { normalizePptxSlide } from "./pptx/slide";

export function normalizePptxModel(model: unknown): PptxModel {
  if (!isRecord(model) || !Array.isArray(model.slides)) return { slides: [] };
  return {
    slideWidthEmu: numericField(model.slideWidthEmu),
    slideHeightEmu: numericField(model.slideHeightEmu),
    slideSizeType:
      typeof model.slideSizeType === "string" ? model.slideSizeType : undefined,
    layouts: Array.isArray(model.layouts)
      ? model.layouts
          .map((layout) => normalizePptxLayout(layout))
          .filter((layout): layout is PptxLayout => layout !== null)
      : undefined,
    masters: Array.isArray(model.masters)
      ? model.masters
          .map((master) => normalizePptxMaster(master))
          .filter((master): master is PptxMaster => master !== null)
      : undefined,
    themes: Array.isArray(model.themes)
      ? model.themes
          .map((theme) => normalizePptxTheme(theme))
          .filter((theme): theme is PptxTheme => theme !== null)
      : undefined,
    tableStyles: Array.isArray(model.tableStyles)
      ? model.tableStyles
          .map((style) => normalizePptxTableStyle(style))
          .filter((style): style is PptxTableStyle => style !== null)
      : undefined,
    slides: model.slides.map((slide, slideIndex) =>
      normalizePptxSlide(slide, slideIndex),
    ),
  };
}
