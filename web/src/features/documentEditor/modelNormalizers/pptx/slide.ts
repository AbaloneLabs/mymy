import type { PptxAnimation, PptxSlide } from "../../shared/models";
import { isRecord, numericField } from "../shared";
import {
  normalizePptxCharts,
  normalizePptxImages,
  normalizePptxMedia,
  normalizePptxShapes,
  normalizePptxTables,
  normalizePptxText,
} from "./objects";
import {
  normalizePptxAnimation,
  normalizePptxTransition,
} from "./timing";

export { normalizePptxText } from "./objects";

export function normalizePptxSlide(slide: unknown, slideIndex: number): PptxSlide {
  const item = isRecord(slide) ? slide : {};
  const texts = Array.isArray(item.texts) ? item.texts : [];
  const shapes = Array.isArray(item.shapes) ? item.shapes : [];
  const tables = Array.isArray(item.tables) ? item.tables : [];
  const images = Array.isArray(item.images) ? item.images : [];
  const media = Array.isArray(item.media) ? item.media : [];
  const charts = Array.isArray(item.charts) ? item.charts : [];

  return {
    id: typeof item.id === "string" ? item.id : `slide${slideIndex + 1}`,
    name:
      typeof item.name === "string" ? item.name : `slide-${slideIndex + 1}`,
    backgroundColor:
      typeof item.backgroundColor === "string"
        ? item.backgroundColor
        : undefined,
    backgroundKind:
      item.backgroundKind === "solid" ||
      item.backgroundKind === "gradient" ||
      item.backgroundKind === "image" ||
      item.backgroundKind === "preserved"
        ? item.backgroundKind
        : undefined,
    backgroundGradientStart:
      typeof item.backgroundGradientStart === "string"
        ? item.backgroundGradientStart
        : undefined,
    backgroundGradientEnd:
      typeof item.backgroundGradientEnd === "string"
        ? item.backgroundGradientEnd
        : undefined,
    backgroundGradientAngle: numericField(item.backgroundGradientAngle),
    backgroundImageRelationshipId:
      typeof item.backgroundImageRelationshipId === "string"
        ? item.backgroundImageRelationshipId
        : undefined,
    backgroundImageMediaPath:
      typeof item.backgroundImageMediaPath === "string"
        ? item.backgroundImageMediaPath
        : undefined,
    backgroundImageMimeType:
      typeof item.backgroundImageMimeType === "string"
        ? item.backgroundImageMimeType
        : undefined,
    backgroundImageDataUrl:
      typeof item.backgroundImageDataUrl === "string"
        ? item.backgroundImageDataUrl
        : undefined,
    backgroundSourceXml:
      typeof item.backgroundSourceXml === "string"
        ? item.backgroundSourceXml
        : undefined,
    notes: typeof item.notes === "string" ? item.notes : undefined,
    layoutRelationshipId:
      typeof item.layoutRelationshipId === "string"
        ? item.layoutRelationshipId
        : undefined,
    layoutPath:
      typeof item.layoutPath === "string" ? item.layoutPath : undefined,
    layoutName:
      typeof item.layoutName === "string" ? item.layoutName : undefined,
    layoutType:
      typeof item.layoutType === "string" ? item.layoutType : undefined,
    layoutMasterPath:
      typeof item.layoutMasterPath === "string"
        ? item.layoutMasterPath
        : undefined,
    layoutMasterName:
      typeof item.layoutMasterName === "string"
        ? item.layoutMasterName
        : undefined,
    layoutThemePath:
      typeof item.layoutThemePath === "string"
        ? item.layoutThemePath
        : undefined,
    layoutThemeName:
      typeof item.layoutThemeName === "string"
        ? item.layoutThemeName
        : undefined,
    transition: normalizePptxTransition(item.transition),
    animations: Array.isArray(item.animations)
      ? item.animations
          .map((animation) => normalizePptxAnimation(animation))
          .filter(
            (animation): animation is PptxAnimation => animation !== null,
          )
      : undefined,
    animationTimingSourceXml:
      typeof item.animationTimingSourceXml === "string"
        ? item.animationTimingSourceXml
        : undefined,
    hidden: item.hidden === true,
    texts: texts.map((text, textIndex) => normalizePptxText(text, textIndex)),
    shapes: normalizePptxShapes(shapes),
    tables: normalizePptxTables(tables),
    images: normalizePptxImages(images),
    media: normalizePptxMedia(media),
    charts: normalizePptxCharts(charts),
  };
}
