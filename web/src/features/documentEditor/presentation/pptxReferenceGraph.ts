import type { PptxSlide } from "../shared/models";
import type { PptxObjectRecord, PptxSelectionKey } from "./pptxSelection";
import { parsePptxSelectionKey, pptxSelectionKey } from "./pptxSelection";

export type PptxDeletionImpact = {
  animationIds: string[];
  mediaIds: string[];
  shapeIds: string[];
};

/**
 * Presentation object ids are editor collection keys, while OOXML timing and
 * media nodes address non-visual shape ids. Keeping that distinction in one
 * helper prevents a visually successful delete from leaving a package-level
 * target behind.
 */
export function pptxDeletionImpact(
  slide: PptxSlide,
  keys: ReadonlySet<PptxSelectionKey>,
): PptxDeletionImpact {
  const shapeIds = pptxObjectShapeIds(slide, keys);
  return {
    shapeIds: [...shapeIds],
    animationIds: (slide.animations ?? [])
      .filter(
        (animation) =>
          animation.targetShapeId && shapeIds.has(animation.targetShapeId),
      )
      .map((animation) => animation.id),
    mediaIds: (slide.media ?? [])
      .filter((media) => media.shapeId && shapeIds.has(media.shapeId))
      .map((media) => media.id),
  };
}

export function deletePptxObjectsWithDependents(
  slide: PptxSlide,
  keys: ReadonlySet<PptxSelectionKey>,
): PptxSlide {
  const impact = pptxDeletionImpact(slide, keys);
  const removedShapeIds = new Set(impact.shapeIds);
  return {
    ...slide,
    texts: slide.texts.filter(
      (object) => !keys.has(pptxSelectionKey("text", object.id)),
    ),
    shapes: (slide.shapes ?? []).filter(
      (object) => !keys.has(pptxSelectionKey("shape", object.id)),
    ),
    images: (slide.images ?? []).filter(
      (object) => !keys.has(pptxSelectionKey("image", object.id)),
    ),
    tables: (slide.tables ?? []).filter(
      (object) => !keys.has(pptxSelectionKey("table", object.id)),
    ),
    charts: (slide.charts ?? []).filter(
      (object) => !keys.has(pptxSelectionKey("chart", object.id)),
    ),
    animations: (slide.animations ?? []).filter(
      (animation) =>
        !animation.targetShapeId || !removedShapeIds.has(animation.targetShapeId),
    ),
    media: (slide.media ?? []).filter(
      (media) => !media.shapeId || !removedShapeIds.has(media.shapeId),
    ),
  };
}

export function pptxObjectDuplicationBlockReason(
  slide: PptxSlide,
  selectedObjects: PptxObjectRecord[],
) {
  const keys = new Set(
    selectedObjects.map((record) =>
      pptxSelectionKey(record.objectKind, record.objectId),
    ),
  );
  const impact = pptxDeletionImpact(slide, keys);
  if (impact.animationIds.length > 0 || impact.mediaIds.length > 0) {
    return "Objects with animation or media targets cannot be duplicated safely yet";
  }
  if (
    selectedObjects.some(
      (record) =>
        record.objectKind === "text" &&
        "complexText" in record.object &&
        record.object.complexText,
    )
  ) {
    return "Rich text boxes cannot be duplicated without flattening their runs";
  }
  if (
    selectedObjects.some(
      (record) =>
        record.objectKind === "table" &&
        "preservationOnly" in record.object &&
        record.object.preservationOnly,
    )
  ) {
    return "Rich or merged tables cannot be duplicated without flattening content";
  }
  if (selectedObjects.some((record) => record.objectKind === "chart")) {
    return "Charts require a package-aware clone and cannot be duplicated safely yet";
  }
  if (
    selectedObjects.some(
      (record) =>
        record.objectKind === "image" &&
        (!("dataUrl" in record.object) || !record.object.dataUrl),
    )
  ) {
    return "Images without embedded data cannot be duplicated safely yet";
  }
  return null;
}

export function pptxSlideDuplicationBlockReason(slide: PptxSlide) {
  if (slide.texts.some((text) => text.complexText)) {
    return "Slides containing rich text boxes cannot be duplicated safely yet";
  }
  if (slide.tables?.some((table) => table.preservationOnly)) {
    return "Slides containing rich or merged tables cannot be duplicated safely yet";
  }
  if ((slide.media?.length ?? 0) > 0) {
    return "Slides containing audio or video cannot be duplicated safely yet";
  }
  if (
    (slide.animations?.length ?? 0) > 0 ||
    Boolean(slide.animationTimingSourceXml)
  ) {
    return "Slides containing animation timing cannot be duplicated safely yet";
  }
  if ((slide.images ?? []).some((image) => !image.dataUrl)) {
    return "Slides containing non-embedded images cannot be duplicated safely yet";
  }
  if ((slide.charts ?? []).some((chart) => !chart.path)) {
    return "Slides containing unresolved charts cannot be duplicated safely yet";
  }
  return null;
}

export function pptxGroupingBlockReason(slide: PptxSlide) {
  if (slide.texts.some((text) => text.complexText)) {
    return "Grouping would flatten a preserved rich text box";
  }
  if (slide.tables?.some((table) => table.preservationOnly)) {
    return "Grouping would flatten a preserved rich or merged table";
  }
  if (
    (slide.animations?.some((animation) => animation.targetShapeId) ?? false) ||
    (slide.media?.some((media) => media.shapeId) ?? false)
  ) {
    return "Grouping would reallocate referenced OOXML shape ids";
  }
  return null;
}

export function pptxObjectDeletionBlockReason(
  slide: PptxSlide,
  keys: ReadonlySet<PptxSelectionKey>,
) {
  const deletesRichText = slide.texts.some(
    (text) =>
      text.complexText && keys.has(pptxSelectionKey("text", text.id)),
  );
  return deletesRichText
    ? "Rich text boxes cannot be deleted safely with the current package model"
    : null;
}

function pptxObjectShapeIds(
  slide: PptxSlide,
  keys: ReadonlySet<PptxSelectionKey>,
) {
  const shapeIds = new Set<string>();
  const collections = {
    text: slide.texts,
    shape: slide.shapes ?? [],
    image: slide.images ?? [],
    table: slide.tables ?? [],
    chart: slide.charts ?? [],
  };
  keys.forEach((key) => {
    const parsed = parsePptxSelectionKey(key);
    const object = collections[parsed.objectKind].find(
      (item) => item.id === parsed.objectId,
    );
    if (object?.shapeId) shapeIds.add(object.shapeId);
  });
  return shapeIds;
}
