import type { Dispatch, SetStateAction } from "react";
import { builtInFontFamilies } from "../shared/fonts";
import {
  nextPptxChartId,
  nextPptxImageId,
  nextPptxShapeId,
  nextPptxSlidePath,
  nextPptxTableId,
  nextPptxTextId,
} from "./pptxEditorUtils";
import type {
  PptxAnimation,
  PptxMaster,
  PptxModel,
  PptxSlide,
  PptxTheme,
  PptxTransition,
} from "../shared/models";
import type { PptxAnimationPresetClass } from "./pptxInspectors";
import { resetPptxSlideToLayout } from "./pptxLayoutReset";
import { pptxSlideDuplicationBlockReason } from "./pptxReferenceGraph";

type PptxSlideActionParams = {
  activeObjectShapeId?: string;
  clearObjectSelection: () => void;
  model: PptxModel;
  onChange: (model: PptxModel) => void;
  selectText: (textId: string | null, additive?: boolean) => void;
  setPreferredSlideId: Dispatch<SetStateAction<string | null>>;
  slide: PptxSlide | undefined;
};

export function createPptxSlideActions({
  activeObjectShapeId,
  clearObjectSelection,
  model,
  onChange,
  selectText,
  setPreferredSlideId,
  slide,
}: PptxSlideActionParams) {
  function updateSlide(patch: Partial<PptxSlide>) {
    if (!slide) return;
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id ? { ...item, ...patch } : item,
      ),
    });
  }

  function updatePresentation(patch: Partial<PptxModel>) {
    onChange({
      ...model,
      ...patch,
    });
  }

  function updateTheme(themePath: string, patch: Partial<PptxTheme>) {
    onChange({
      ...model,
      themes: (model.themes ?? []).map((theme) =>
        theme.path === themePath ? { ...theme, ...patch } : theme,
      ),
    });
  }

  function updateMaster(masterPath: string, patch: Partial<PptxMaster>) {
    onChange({
      ...model,
      masters: (model.masters ?? []).map((master) =>
        master.path === masterPath ? { ...master, ...patch } : master,
      ),
    });
  }

  function updateSlideNotes(notes: string) {
    updateSlide({ notes });
  }

  function toggleSlideHidden() {
    if (!slide) return;
    updateSlide({ hidden: !slide.hidden });
  }

  function updateSlideTransition(patch: Partial<PptxTransition>) {
    const current = slide?.transition ?? { type: "none" as const };
    updateSlide({ transition: { ...current, ...patch } });
  }

  function updateSlideLayout(layoutPath: string) {
    const layout = model.layouts?.find((item) => item.path === layoutPath);
    if (!layout) {
      updateSlide({
        layoutPath: undefined,
        layoutName: undefined,
        layoutType: undefined,
        layoutMasterPath: undefined,
        layoutMasterName: undefined,
        layoutThemePath: undefined,
        layoutThemeName: undefined,
      });
      return;
    }
    updateSlide({
      layoutPath: layout.path,
      layoutName: layout.name,
      layoutType: layout.type,
      layoutMasterPath: layout.masterPath,
      layoutMasterName: layout.masterName,
      layoutThemePath: layout.themePath,
      layoutThemeName: layout.themeName,
    });
  }

  function resetSlideLayout() {
    if (!slide?.layoutPath) return;
    const layout = model.layouts?.find((item) => item.path === slide.layoutPath);
    if (!layout || (layout.placeholderTexts?.length ?? 0) === 0) return;
    if (slide.texts.some((text) => text.placeholderType && text.complexText)) {
      window.alert(
        "Layout reset is unavailable because a placeholder contains preserved rich text.",
      );
      return;
    }
    const reset = resetPptxSlideToLayout(slide, layout);
    const confirmed = window.confirm(
      [
        `Reset ${reset.preview.matchedPlaceholderCount} matched placeholder(s).`,
        `Create ${reset.preview.createdPlaceholderCount} missing placeholder(s).`,
        `Preserve ${reset.preview.preservedObjectCount} user or unmatched object(s).`,
      ].join("\n"),
    );
    if (!confirmed) return;
    updateSlide({ texts: reset.slide.texts });
    clearObjectSelection();
  }

  function updateSlideAnimations(updater: (animations: PptxAnimation[]) => PptxAnimation[]) {
    if (!slide) return;
    updateSlide({ animations: updater(slide.animations ?? []) });
  }

  function updateAnimationTiming(
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) {
    updateSlideAnimations((animations) =>
      animations.map((animation) =>
        animation.id === animationId ? { ...animation, ...patch } : animation,
      ),
    );
  }

  function moveAnimation(animationId: string, direction: -1 | 1) {
    updateSlideAnimations((animations) => {
      const index = animations.findIndex((animation) => animation.id === animationId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= animations.length) {
        return animations;
      }
      const next = [...animations];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function addAnimation(presetClass: PptxAnimationPresetClass) {
    if (!activeObjectShapeId) {
      window.alert(
        "Select a saved slide object with a stable OOXML shape id before adding animation.",
      );
      return;
    }
    updateSlideAnimations((animations) => {
      const id = nextPptxAnimationId(animations);
      const animation = createPptxAnimation(id, presetClass, activeObjectShapeId);
      return [...animations, animation];
    });
  }

  function deleteAnimation(animationId: string) {
    updateSlideAnimations((animations) =>
      animations.filter((animation) => animation.id !== animationId),
    );
  }

  function addSlide() {
    const slideNumber = model.slides.length + 1;
    const path = nextPptxSlidePath(model);
    const next = {
      id: path,
      name: path.split("/").at(-1) ?? `slide${slideNumber}.xml`,
      notes: "",
      layoutPath: slide?.layoutPath,
      layoutName: slide?.layoutName,
      layoutType: slide?.layoutType,
      layoutMasterPath: slide?.layoutMasterPath,
      layoutMasterName: slide?.layoutMasterName,
      layoutThemePath: slide?.layoutThemePath,
      layoutThemeName: slide?.layoutThemeName,
      backgroundKind: "solid" as const,
      backgroundColor: "#ffffff",
      tables: [],
      images: [],
      charts: [],
      texts: [
        {
          id: "t1",
          text: "",
          x: 12,
          y: 14,
          width: 76,
          height: 18,
          fontSize: "28",
          fontFamily: builtInFontFamilies[0],
          bold: true,
        },
      ],
    };
    onChange({ ...model, slides: [...model.slides, next] });
    setPreferredSlideId(next.id);
    selectText("t1");
  }

  function duplicateSlide() {
    if (!slide) return;
    const blockReason = pptxSlideDuplicationBlockReason(slide);
    if (blockReason) {
      window.alert(blockReason);
      return;
    }
    const path = nextPptxSlidePath(model);
    const next = {
      ...slide,
      id: path,
      name: path.split("/").at(-1) ?? "slide.xml",
      texts: slide.texts.map((text, index) => ({
        ...text,
        id: nextPptxTextId(slide.texts, index + 1),
        shapeId: undefined,
        groupShapeId: undefined,
        textIndex: undefined,
      })),
      shapes: (slide.shapes ?? []).map((shape, index) => ({
        ...shape,
        id: nextPptxShapeId(slide.shapes ?? [], index + 1),
        shapeId: undefined,
        groupShapeId: undefined,
      })),
      tables: (slide.tables ?? []).map((table, index) => ({
        ...table,
        id: nextPptxTableId(slide.tables ?? [], index + 1),
        shapeId: undefined,
        groupShapeId: undefined,
        textIndexStart: undefined,
        rows: table.rows.map((row) => [...row]),
        cellStyles: table.cellStyles?.map((row) =>
          row.map((cell) => ({ ...cell })),
        ),
      })),
      images: (slide.images ?? []).map((image, index) => ({
        ...image,
        id: nextPptxImageId(slide.images ?? [], index + 1),
        shapeId: undefined,
        groupShapeId: undefined,
        relationshipId: undefined,
        mediaPath: undefined,
      })),
      charts: (slide.charts ?? []).map((chart, index) => ({
        ...chart,
        id: nextPptxChartId(slide.charts ?? [], index + 1),
        shapeId: undefined,
        groupShapeId: undefined,
        relationshipId: undefined,
        series: chart.series?.map((series) => ({
          ...series,
          categories: series.categories ? [...series.categories] : undefined,
          values: series.values ? [...series.values] : undefined,
        })),
        categories: chart.categories ? [...chart.categories] : undefined,
      })),
    };
    onChange({ ...model, slides: [...model.slides, next] });
    setPreferredSlideId(next.id);
    selectText(next.texts[0]?.id ?? null);
  }

  function deleteSlide() {
    if (!slide || model.slides.length <= 1) return;
    const nextSlides = model.slides.filter((item) => item.id !== slide.id);
    onChange({ ...model, slides: nextSlides });
    setPreferredSlideId(nextSlides[0]?.id ?? null);
    clearObjectSelection();
  }

  function moveSlide(direction: -1 | 1) {
    if (!slide) return;
    const index = model.slides.findIndex((item) => item.id === slide.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= model.slides.length) return;
    const slides = [...model.slides];
    const [moved] = slides.splice(index, 1);
    slides.splice(nextIndex, 0, moved);
    onChange({ ...model, slides });
  }

  return {
    addAnimation,
    addSlide,
    deleteAnimation,
    deleteSlide,
    duplicateSlide,
    moveAnimation,
    moveSlide,
    resetSlideLayout,
    toggleSlideHidden,
    updateAnimationTiming,
    updateMaster,
    updatePresentation,
    updateSlide,
    updateSlideLayout,
    updateSlideNotes,
    updateSlideTransition,
    updateTheme,
  };
}

function nextPptxAnimationId(animations: PptxAnimation[]) {
  const used = new Set(animations.map((animation) => animation.id));
  const maxNumericId = animations
    .map((animation) => Number(animation.id))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((max, value) => Math.max(max, value), 0);
  let index = Math.max(1, maxNumericId + 1);
  while (used.has(String(index))) index += 1;
  return String(index);
}

function createPptxAnimation(
  id: string,
  presetClass: PptxAnimationPresetClass,
  targetShapeId: string,
): PptxAnimation {
  const durationMs = presetClass === "emph" ? 700 : 500;
  return {
    id,
    nodeType: "clickEffect",
    presetClass,
    presetId: "1",
    targetShapeId,
    delayMs: 0,
    durationMs,
  };
}
