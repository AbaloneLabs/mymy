import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { EditorCommandRequest } from "../commands";
import { builtInFontFamilies } from "../fonts";
import {
  SLIDE_ASPECT_RATIO,
  clampPercent,
  firstVisibleSlideIndex,
  lockedAspectResize,
  nextPptxChartId,
  nextPptxGroupId,
  nextPptxImageId,
  nextPptxShapeId,
  nextPptxSlidePath,
  nextPptxTableId,
  nextPptxTextId,
  nextVisibleSlideIndex,
  isPptxLineShapeKind,
  reorderPptxObjectsById,
} from "../pptxEditorUtils";
import type { PptxSnapGuide, SlideDragState } from "../pptxEditorUtils";
import {
  pptxBoundsFromItems,
  pptxMoveSnap,
  pptxObjectContainsPoint,
  pptxResizeSnap,
  pptxSnapTargets,
} from "../pptxEditorGeometry";
import {
  parsePptxSelectionKey,
  patchPptxSlideObjects,
  pptxObjectIntersectsSelectionBox,
  pptxSelectionBounds,
  pptxSelectionBoxBounds,
  pptxSelectionKey,
  pptxSlideObjectRecords,
} from "../pptxSelection";
import type {
  PptxGeometryPatch,
  PptxObjectKind,
  PptxSelectionBox,
  PptxSelectionKey,
} from "../pptxSelection";
import type {
  PptxModel,
  PptxAnimation,
  PptxChart,
  PptxImage,
  PptxMedia,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
  PptxTheme,
  PptxTransition,
} from "../models";
import {
  PptxAnimationInspector,
  PptxMediaInspector,
} from "../pptxInspectors";
import { PptxChartDataEditor } from "../pptxEditorPanels";
import { runPptxEditorCommand } from "../pptxEditorCommands";
import {
  PptxObjectLayerPanel,
  PptxPresentationOverlay,
  PptxSlideNavigator,
} from "../pptxPresentationPanels";
import { PptxEditorToolbar } from "../pptxEditorToolbar";
import { duplicatePptxSelectedObjects } from "../pptxObjectDuplication";
import { PptxSlideCanvas } from "../pptxSlideCanvas";
import { createPptxTableEditors } from "../pptxTableEditors";
import { PptxThemeEditor } from "../pptxThemeEditor";
import { derivePptxEditorState } from "../pptxEditorState";

export function PptxEditor({
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  model: PptxModel;
  onChange: (model: PptxModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const { t } = useTranslation();
  const [preferredSlideId, setPreferredSlideId] = useState<string | null>(null);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [activeShapeId, setActiveShapeId] = useState<string | null>(null);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [selectedObjectKeys, setSelectedObjectKeys] = useState<PptxSelectionKey[]>(
    [],
  );
  const [dragState, setDragState] = useState<SlideDragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<PptxSelectionBox | null>(null);
  const [snapGuides, setSnapGuides] = useState<PptxSnapGuide[]>([]);
  const [presentingIndex, setPresentingIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const {
    activeChart,
    activeImage,
    activeLayerIndex,
    activeLayerLength,
    activeObject,
    activeObjectKey,
    activeShape,
    activeTable,
    activeText,
    hasGroupedSelection,
    hasMultiSelection,
    hasObjectSelection,
    selectedObjectKeySet,
    selectedObjects,
    activeTheme,
    presentingSlide,
    selectionBoxBounds,
    slide,
    slideIndex,
  } = derivePptxEditorState({
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
  });

  useEffect(() => {
    function handlePresentationShortcut(event: KeyboardEvent) {
      if (event.key !== "F5") return;
      event.preventDefault();
      setPresentingIndex(
        event.shiftKey
          ? nextVisibleSlideIndex(model.slides, slideIndex, 1, true)
          : firstVisibleSlideIndex(model.slides),
      );
    }
    window.addEventListener("keydown", handlePresentationShortcut);
    return () => window.removeEventListener("keydown", handlePresentationShortcut);
  }, [model.slides, slideIndex]);

  function activateObjectKey(key: PptxSelectionKey | null) {
    const parsed = key ? parsePptxSelectionKey(key) : null;
    setActiveTextId(parsed?.objectKind === "text" ? parsed.objectId : null);
    setActiveShapeId(parsed?.objectKind === "shape" ? parsed.objectId : null);
    setActiveImageId(parsed?.objectKind === "image" ? parsed.objectId : null);
    setActiveTableId(parsed?.objectKind === "table" ? parsed.objectId : null);
    setActiveChartId(parsed?.objectKind === "chart" ? parsed.objectId : null);
  }

  function clearObjectSelection() {
    activateObjectKey(null);
    setSelectedObjectKeys([]);
  }

  function selectionKeysForObject(
    objectKind: PptxObjectKind,
    objectId: string,
  ): PptxSelectionKey[] {
    const key = pptxSelectionKey(objectKind, objectId);
    if (!slide) return [key];
    const records = pptxSlideObjectRecords(slide);
    const record = records.find(
      (item) => item.objectKind === objectKind && item.objectId === objectId,
    );
    if (!record?.object.groupId) return [key];
    return records
      .filter((item) => item.object.groupId === record.object.groupId)
      .map((item) => pptxSelectionKey(item.objectKind, item.objectId));
  }

  function expandGroupedSelectionKeys(keys: PptxSelectionKey[]) {
    if (!slide) return keys;
    const expanded = new Set<PptxSelectionKey>();
    keys.forEach((key) => {
      const parsed = parsePptxSelectionKey(key);
      selectionKeysForObject(parsed.objectKind, parsed.objectId).forEach((item) =>
        expanded.add(item),
      );
    });
    return Array.from(expanded);
  }

  function selectObject(
    objectKind: PptxObjectKind,
    objectId: string,
    additive = false,
  ) {
    const key = pptxSelectionKey(objectKind, objectId);
    const keys = selectionKeysForObject(objectKind, objectId);
    if (!additive) {
      activateObjectKey(key);
      setSelectedObjectKeys(keys);
      return;
    }
    const keySet = new Set(keys);
    const exists = keys.every((item) => selectedObjectKeys.includes(item));
    const next = exists
      ? selectedObjectKeys.filter((item) => !keySet.has(item))
      : Array.from(new Set([...selectedObjectKeys, ...keys]));
    const nextActive = exists ? (next.at(-1) ?? null) : key;
    activateObjectKey(nextActive);
    setSelectedObjectKeys(next);
  }

  function selectText(textId: string | null, additive = false) {
    if (textId) selectObject("text", textId, additive);
    else if (!additive) clearObjectSelection();
  }

  function selectShape(shapeId: string | null, additive = false) {
    if (shapeId) selectObject("shape", shapeId, additive);
    else if (!additive) clearObjectSelection();
  }

  function selectImage(imageId: string | null, additive = false) {
    if (imageId) selectObject("image", imageId, additive);
    else if (!additive) clearObjectSelection();
  }

  function selectTable(tableId: string | null, additive = false) {
    if (tableId) selectObject("table", tableId, additive);
    else if (!additive) clearObjectSelection();
  }

  function selectChart(chartId: string | null, additive = false) {
    if (chartId) selectObject("chart", chartId, additive);
    else if (!additive) clearObjectSelection();
  }

  function selectAllSlideObjects() {
    if (!slide) return;
    const keys = pptxSlideObjectRecords(slide).map((record) =>
      pptxSelectionKey(record.objectKind, record.objectId),
    );
    setSelectedObjectKeys(keys);
    activateObjectKey(keys.at(-1) ?? null);
  }

  function updateSlide(patch: Partial<PptxSlide>) {
    if (!slide) return;
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id ? { ...item, ...patch } : item,
      ),
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

  function updateThemeColor(themePath: string, key: string, color: string) {
    onChange({
      ...model,
      themes: (model.themes ?? []).map((theme) =>
        theme.path === themePath
          ? {
              ...theme,
              colors: {
                ...(theme.colors ?? {}),
                [key]: color,
              },
            }
          : theme,
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
        layoutThemePath: undefined,
        layoutThemeName: undefined,
      });
      return;
    }
    updateSlide({
      layoutPath: layout.path,
      layoutName: layout.name,
      layoutType: layout.type,
      layoutThemePath: layout.themePath,
      layoutThemeName: layout.themeName,
    });
  }

  function resetSlideLayout() {
    if (!slide?.layoutPath) return;
    const layout = model.layouts?.find((item) => item.path === slide.layoutPath);
    const placeholders = layout?.placeholderTexts ?? [];
    if (placeholders.length === 0) return;
    updateSlide({
      texts: placeholders.map((text, index) => ({
        ...text,
        id: `t${index + 1}`,
        textIndex: undefined,
      })),
    });
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

  function updateSlideTexts(
    slideId: string,
    updater: (texts: PptxText[]) => PptxText[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId ? { ...item, texts: updater(item.texts) } : item,
      ),
    });
  }

  function updateSlideShapes(
    slideId: string,
    updater: (shapes: PptxShape[]) => PptxShape[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, shapes: updater(item.shapes ?? []) }
          : item,
      ),
    });
  }

  function updateSlideTables(
    slideId: string,
    updater: (tables: PptxTable[]) => PptxTable[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, tables: updater(item.tables ?? []) }
          : item,
      ),
    });
  }

  const {
    addTableColumn,
    addTableRow,
    deleteTableColumn,
    deleteTableRow,
    updateTableById,
    updateTableCell,
    updateTableCellStyle,
    updateTableColumnWidth,
    updateTableRowHeight,
  } = createPptxTableEditors({
    slide,
    updateSlideTables,
  });

  function updateSlideImages(
    slideId: string,
    updater: (images: PptxImage[]) => PptxImage[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, images: updater(item.images ?? []) }
          : item,
      ),
    });
  }

  function updateSlideCharts(
    slideId: string,
    updater: (charts: PptxChart[]) => PptxChart[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, charts: updater(item.charts ?? []) }
          : item,
      ),
    });
  }

  function updateSlideMedia(
    slideId: string,
    updater: (media: PptxMedia[]) => PptxMedia[],
  ) {
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, media: updater(item.media ?? []) }
          : item,
      ),
    });
  }

  function updateTextById(textId: string, patch: Partial<PptxText>) {
    if (!slide) return;
    updateSlideTexts(slide.id, (texts) =>
      texts.map((textItem) =>
        textItem.id === textId ? { ...textItem, ...patch } : textItem,
      ),
    );
  }

  function updateShapeById(shapeId: string, patch: Partial<PptxShape>) {
    if (!slide) return;
    updateSlideShapes(slide.id, (shapes) =>
      shapes.map((shape) =>
        shape.id === shapeId ? { ...shape, ...patch } : shape,
      ),
    );
  }

  function updateImageById(imageId: string, patch: Partial<PptxImage>) {
    if (!slide) return;
    updateSlideImages(slide.id, (images) =>
      images.map((image) =>
        image.id === imageId ? { ...image, ...patch } : image,
      ),
    );
  }

  function updateChartById(chartId: string, patch: Partial<PptxChart>) {
    if (!slide) return;
    updateSlideCharts(slide.id, (charts) =>
      charts.map((chart) =>
        chart.id === chartId ? { ...chart, ...patch } : chart,
      ),
    );
  }

  function updateMediaById(mediaId: string, patch: Partial<PptxMedia>) {
    if (!slide) return;
    updateSlideMedia(slide.id, (media) =>
      media.map((item) => (item.id === mediaId ? { ...item, ...patch } : item)),
    );
  }

  function updateChartSeriesName(seriesIndex: number, value: string) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) =>
        currentIndex === seriesIndex ? { ...series, name: value } : series,
      ),
    });
  }

  function updateChartSeriesPoint(
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        const nextValues = [...(series[key] ?? [])];
        nextValues[pointIndex] = value;
        return { ...series, [key]: nextValues };
      }),
    });
  }

  function addChartSeries() {
    if (!activeChart) return;
    const rowCount = activeChart.categories?.length ?? 0;
    updateActiveChart({
      series: [
        ...(activeChart.series ?? []),
        {
          categories: Array.from({ length: rowCount }, (_, index) =>
            activeChart.categories?.[index] ?? "",
          ),
          values: Array.from({ length: rowCount }, () => ""),
        },
      ],
    });
  }

  function deleteChartSeries(seriesIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).filter(
        (_series, currentIndex) => currentIndex !== seriesIndex,
      ),
    });
  }

  function addChartPoint(seriesIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        return {
          ...series,
          categories: [
            ...(series.categories ?? activeChart.categories ?? []),
            "",
          ],
          values: [...(series.values ?? []), ""],
        };
      }),
    });
  }

  function deleteChartPoint(seriesIndex: number, pointIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        return {
          ...series,
          categories: (series.categories ?? activeChart.categories ?? []).filter(
            (_category, currentPointIndex) => currentPointIndex !== pointIndex,
          ),
          values: (series.values ?? []).filter(
            (_value, currentPointIndex) => currentPointIndex !== pointIndex,
          ),
        };
      }),
    });
  }

  function updateText(textIndex: number, text: string) {
    if (!slide) return;
    updateSlideTexts(slide.id, (texts) =>
      texts.map((textItem, currentIndex) =>
        currentIndex === textIndex ? { ...textItem, text } : textItem,
      ),
    );
  }

  function updateActiveText(patch: Partial<PptxText>) {
    if (!slide || !activeText) return;
    updateTextById(activeText.id, patch);
  }

  function updateActiveShape(patch: Partial<PptxShape>) {
    if (!slide || !activeShape) return;
    updateShapeById(activeShape.id, patch);
  }

  function updateActiveImage(patch: Partial<PptxImage>) {
    if (!slide || !activeImage) return;
    updateImageById(activeImage.id, patch);
  }

  function updateActiveTable(patch: Partial<PptxTable>) {
    if (!slide || !activeTable) return;
    updateTableById(activeTable.id, patch);
  }

  function updateActiveChart(patch: Partial<PptxChart>) {
    if (!slide || !activeChart) return;
    updateChartById(activeChart.id, patch);
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
    const path = nextPptxSlidePath(model);
    const next = {
      ...slide,
      id: path,
      name: path.split("/").at(-1) ?? "slide.xml",
      texts: slide.texts.map((text, index) => ({
        ...text,
        id: nextPptxTextId(slide.texts, index + 1),
      })),
      shapes: (slide.shapes ?? []).map((shape, index) => ({
        ...shape,
        id: nextPptxShapeId(slide.shapes ?? [], index + 1),
      })),
      tables: (slide.tables ?? []).map((table, index) => ({
        ...table,
        id: nextPptxTableId(slide.tables ?? [], index + 1),
      })),
      images: (slide.images ?? []).map((image, index) => ({
        ...image,
        id: nextPptxImageId(slide.images ?? [], index + 1),
        relationshipId: undefined,
        mediaPath: undefined,
      })),
      charts: (slide.charts ?? []).map((chart, index) => ({
        ...chart,
        id: nextPptxChartId(slide.charts ?? [], index + 1),
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

  function addTextBox() {
    if (!slide) return;
    const next = {
      id: nextPptxTextId(slide.texts),
      text: "",
      x: 18,
      y: 34,
      width: 64,
      height: 14,
      rotation: 0,
      fontSize: "18",
      fontFamily: builtInFontFamilies[0],
    };
    updateSlideTexts(slide.id, (texts) => [...texts, next]);
    selectText(next.id);
  }

  function addShape(kind: PptxShape["kind"]) {
    if (!slide) return;
    const lineLike = isPptxLineShapeKind(kind);
    const next: PptxShape = {
      id: nextPptxShapeId(slide.shapes ?? []),
      kind,
      x: lineLike ? 22 : 24,
      y: lineLike ? 50 : 34,
      width: lineLike ? 52 : 26,
      height: lineLike ? 0 : 20,
      rotation: 0,
      fillColor: lineLike ? undefined : "#dbeafe",
      strokeColor: "#2563eb",
      strokeWidth: 2,
    };
    updateSlideShapes(slide.id, (shapes) => [...shapes, next]);
    selectShape(next.id);
  }

  function addTable() {
    if (!slide) return;
    const next: PptxTable = {
      id: nextPptxTableId(slide.tables ?? []),
      x: 18,
      y: 30,
      width: 58,
      height: 24,
      rotation: 0,
      tableStyleId: "{5940675A-B579-460E-94D1-54222C63F5DA}",
      firstRow: true,
      bandedRows: true,
      columnWidths: [33.333, 33.333, 33.334],
      rowHeights: [33.333, 33.333, 33.334],
      rows: [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ],
    };
    updateSlideTables(slide.id, (tables) => [...tables, next]);
    selectTable(next.id);
  }

  function addImageFile(file: File) {
    if (!slide || !file.type.startsWith("image/")) return;
    const slideId = slide.id;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      const commitImage = (width: number, height: number) => {
        const next: PptxImage = {
          id: nextPptxImageId(slide.images ?? []),
          mimeType: file.type || undefined,
          dataUrl,
          x: Math.max(0, (100 - width) / 2),
          y: Math.max(0, (100 - height) / 2),
          width,
          height,
          rotation: 0,
          altText: file.name.replace(/\.[^.]+$/, ""),
        };
        updateSlideImages(slideId, (images) => [...images, next]);
        selectImage(next.id);
      };
      const preview = new window.Image();
      preview.onload = () => {
        const aspect = preview.naturalWidth / Math.max(preview.naturalHeight, 1);
        const width = 38;
        const height = Math.min(70, Math.max(10, (width * SLIDE_ASPECT_RATIO) / aspect));
        commitImage(width, height);
      };
      preview.onerror = () => commitImage(38, 24);
      preview.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function setSlideBackgroundImage(file: File) {
    if (!slide || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      updateSlide({
        backgroundKind: "image",
        backgroundColor: undefined,
        backgroundGradientStart: undefined,
        backgroundGradientEnd: undefined,
        backgroundGradientAngle: undefined,
        backgroundImageRelationshipId: undefined,
        backgroundImageMediaPath: undefined,
        backgroundImageMimeType: file.type || undefined,
        backgroundImageDataUrl: dataUrl,
        backgroundSourceXml: undefined,
      });
    };
    reader.readAsDataURL(file);
  }

  function duplicateActiveObject() {
    if (!slide || !activeObjectKey) return;
    const parsed = parsePptxSelectionKey(activeObjectKey);
    const record = pptxSlideObjectRecords(slide).find(
      (item) =>
        item.objectKind === parsed.objectKind && item.objectId === parsed.objectId,
    );
    if (!record) return;
    const duplicated = duplicatePptxSelectedObjects(slide, [record]);
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id ? duplicated.slide : item,
      ),
    });
    const nextKey = duplicated.selectedKeys[0] ?? null;
    activateObjectKey(nextKey);
    setSelectedObjectKeys(nextKey ? [nextKey] : []);
  }

  function deleteObjectKeys(keys: Set<PptxSelectionKey>) {
    if (!slide || keys.size === 0) return;
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id
          ? {
              ...item,
              texts: item.texts.filter(
                (object) => !keys.has(pptxSelectionKey("text", object.id)),
              ),
              shapes: (item.shapes ?? []).filter(
                (object) => !keys.has(pptxSelectionKey("shape", object.id)),
              ),
              images: (item.images ?? []).filter(
                (object) => !keys.has(pptxSelectionKey("image", object.id)),
              ),
              tables: (item.tables ?? []).filter(
                (object) => !keys.has(pptxSelectionKey("table", object.id)),
              ),
              charts: (item.charts ?? []).filter(
                (object) => !keys.has(pptxSelectionKey("chart", object.id)),
              ),
            }
          : item,
      ),
    });
    clearObjectSelection();
  }

  function deleteActiveObject() {
    if (activeObjectKey) deleteObjectKeys(new Set([activeObjectKey]));
  }

  function moveActiveObjectLayer(direction: -1 | 1) {
    if (activeObjectKey) moveObjectLayer(activeObjectKey, direction);
  }

  function moveObjectLayer(key: PptxSelectionKey, direction: -1 | 1) {
    if (!slide) return;
    const parsed = parsePptxSelectionKey(key);
    if (parsed.objectKind === "text") {
      updateSlideTexts(slide.id, (items) =>
        reorderPptxObjectsById(items, parsed.objectId, direction),
      );
    } else if (parsed.objectKind === "shape") {
      updateSlideShapes(slide.id, (items) =>
        reorderPptxObjectsById(items, parsed.objectId, direction),
      );
    } else if (parsed.objectKind === "image") {
      updateSlideImages(slide.id, (items) =>
        reorderPptxObjectsById(items, parsed.objectId, direction),
      );
    } else if (parsed.objectKind === "table") {
      updateSlideTables(slide.id, (items) =>
        reorderPptxObjectsById(items, parsed.objectId, direction),
      );
    } else {
      updateSlideCharts(slide.id, (items) =>
        reorderPptxObjectsById(items, parsed.objectId, direction),
      );
    }
    activateObjectKey(key);
    setSelectedObjectKeys((current) => (current.includes(key) ? current : [key]));
  }

  function updateActiveObjectGeometry(
    patch: Partial<PptxText & PptxShape & PptxImage & PptxTable & PptxChart>,
  ) {
    if (activeText) {
      updateActiveText(patch);
    } else if (activeShape) {
      updateActiveShape(patch);
    } else if (activeImage) {
      updateActiveImage(patch);
    } else if (activeTable) {
      updateActiveTable(patch);
    } else if (activeChart) {
      updateActiveChart(patch);
    }
  }

  function updateObjectGeometries(patches: Map<PptxSelectionKey, PptxGeometryPatch>) {
    if (!slide || patches.size === 0) return;
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id ? patchPptxSlideObjects(item, patches) : item,
      ),
    });
  }

  function moveSelectedObjects(deltaX: number, deltaY: number) {
    if (!slide || selectedObjects.length === 0) return;
    const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
    selectedObjects.forEach((record) => {
      patches.set(pptxSelectionKey(record.objectKind, record.objectId), {
        x: clampPercent((record.object.x ?? 0) + deltaX),
        y: clampPercent((record.object.y ?? 0) + deltaY),
      });
    });
    updateObjectGeometries(patches);
  }

  function duplicateSelectedObjects() {
    if (!slide || selectedObjects.length <= 1) {
      duplicateActiveObject();
      return;
    }
    const duplicated = duplicatePptxSelectedObjects(slide, selectedObjects);
    onChange({
      ...model,
      slides: model.slides.map((item) =>
        item.id === slide.id ? duplicated.slide : item,
      ),
    });
    setSelectedObjectKeys(duplicated.selectedKeys);
    activateObjectKey(duplicated.selectedKeys.at(-1) ?? null);
  }

  function deleteSelectedObjects() {
    if (!slide || selectedObjects.length <= 1) {
      deleteActiveObject();
      return;
    }
    deleteObjectKeys(new Set(selectedObjectKeys));
  }

  function groupSelectedObjects() {
    if (!slide || selectedObjects.length < 2) return;
    const groupId = nextPptxGroupId(slide);
    const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
    selectedObjects.forEach((record) => {
      patches.set(pptxSelectionKey(record.objectKind, record.objectId), {
        groupId,
      });
    });
    updateObjectGeometries(patches);
  }

  function ungroupSelectedObjects() {
    if (!slide || selectedObjects.length === 0) return;
    const groupIds = new Set(
      selectedObjects
        .map((record) => record.object.groupId)
        .filter((groupId): groupId is string => Boolean(groupId)),
    );
    if (groupIds.size === 0) return;
    const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
    pptxSlideObjectRecords(slide).forEach((record) => {
      if (!record.object.groupId || !groupIds.has(record.object.groupId)) return;
      patches.set(pptxSelectionKey(record.objectKind, record.objectId), {
        groupId: undefined,
      });
    });
    updateObjectGeometries(patches);
  }

  function alignActiveObject(
    edge: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) {
    if (selectedObjects.length > 1) {
      const bounds = pptxSelectionBounds(selectedObjects);
      const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
      selectedObjects.forEach((record) => {
        const width = record.object.width ?? 20;
        const height = record.object.height ?? 10;
        let patch: PptxGeometryPatch;
        if (edge === "left") {
          patch = { x: bounds.x };
        } else if (edge === "center") {
          patch = { x: bounds.x + bounds.width / 2 - width / 2 };
        } else if (edge === "right") {
          patch = { x: bounds.x + bounds.width - width };
        } else if (edge === "top") {
          patch = { y: bounds.y };
        } else if (edge === "middle") {
          patch = { y: bounds.y + bounds.height / 2 - height / 2 };
        } else {
          patch = { y: bounds.y + bounds.height - height };
        }
        patches.set(pptxSelectionKey(record.objectKind, record.objectId), patch);
      });
      updateObjectGeometries(patches);
      return;
    }
    if (!activeObject) return;
    const width = activeObject.width ?? 20;
    const height = activeObject.height ?? 10;
    if (edge === "left") {
      updateActiveObjectGeometry({ x: 0 });
    } else if (edge === "center") {
      updateActiveObjectGeometry({ x: Math.max(0, (100 - width) / 2) });
    } else if (edge === "right") {
      updateActiveObjectGeometry({ x: Math.max(0, 100 - width) });
    } else if (edge === "top") {
      updateActiveObjectGeometry({ y: 0 });
    } else if (edge === "middle") {
      updateActiveObjectGeometry({ y: Math.max(0, (100 - height) / 2) });
    } else {
      updateActiveObjectGeometry({ y: Math.max(0, 100 - height) });
    }
  }

  function distributeSelectedObjects(axis: "horizontal" | "vertical") {
    if (!slide || selectedObjects.length <= 2) return;
    const sorted = [...selectedObjects].sort((left, right) =>
      axis === "horizontal"
        ? (left.object.x ?? 0) - (right.object.x ?? 0)
        : (left.object.y ?? 0) - (right.object.y ?? 0),
    );
    const first = sorted[0];
    const last = sorted.at(-1);
    if (!first || !last) return;
    const start = axis === "horizontal" ? (first.object.x ?? 0) : (first.object.y ?? 0);
    const end =
      axis === "horizontal"
        ? (last.object.x ?? 0) + (last.object.width ?? 0)
        : (last.object.y ?? 0) + (last.object.height ?? 0);
    const occupied = sorted.reduce(
      (total, record) =>
        total +
        (axis === "horizontal"
          ? (record.object.width ?? 0)
          : (record.object.height ?? 0)),
      0,
    );
    const gap = Math.max(0, (end - start - occupied) / (sorted.length - 1));
    let cursor = start;
    const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
    sorted.forEach((record) => {
      const key = pptxSelectionKey(record.objectKind, record.objectId);
      if (axis === "horizontal") {
        patches.set(key, { x: clampPercent(cursor) });
        cursor += (record.object.width ?? 0) + gap;
      } else {
        patches.set(key, { y: clampPercent(cursor) });
        cursor += (record.object.height ?? 0) + gap;
      }
    });
    updateObjectGeometries(patches);
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
      return runPptxEditorCommand(commandId, {
        addSlide,
        duplicateSlide,
        duplicateSelectedObjects,
        deleteSelectedObjects,
        moveActiveObjectLayer,
        groupSelectedObjects,
        ungroupSelectedObjects,
        alignActiveObject,
        distributeSelectedObjects,
        present: () =>
          setPresentingIndex(nextVisibleSlideIndex(model.slides, slideIndex, 1, true)),
        addTable,
        hasObjectSelection,
        hasActiveObject: Boolean(activeObject),
      });
    },
  );

  useEffect(() => {
    if (!commandRequest || handledCommandTokenRef.current === commandRequest.token) return;
    handledCommandTokenRef.current = commandRequest.token;
    window.setTimeout(() => {
      if (handleCommandRequest(commandRequest.id)) {
        onCommandHandled?.(commandRequest);
      }
    }, 0);
  }, [commandRequest, onCommandHandled]);

  function startObjectDrag(
    event: ReactPointerEvent<HTMLElement>,
    objectKind: SlideDragState["objectKind"],
    object: PptxText | PptxShape | PptxImage | PptxTable | PptxChart,
    mode: SlideDragState["mode"],
  ) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    setSnapGuides([]);
    const clickedKey = pptxSelectionKey(objectKind, object.id);
    if (event.altKey && mode === "move" && selectObjectBehindPointer(event, clickedKey, rect)) {
      return;
    }
    const clickedSelectionKeys = selectionKeysForObject(objectKind, object.id);
    const dragSelectionKeys = selectedObjectKeySet.has(clickedKey)
      ? selectedObjectKeys
      : clickedSelectionKeys;
    const dragSelectionKeySet = new Set(dragSelectionKeys);
    if (objectKind === "text") {
      if (!selectedObjectKeySet.has(pptxSelectionKey("text", object.id))) {
        selectText(object.id);
      } else {
        activateObjectKey(pptxSelectionKey("text", object.id));
      }
    } else if (objectKind === "shape") {
      if (!selectedObjectKeySet.has(pptxSelectionKey("shape", object.id))) {
        selectShape(object.id);
      } else {
        activateObjectKey(pptxSelectionKey("shape", object.id));
      }
    } else if (objectKind === "image") {
      if (!selectedObjectKeySet.has(pptxSelectionKey("image", object.id))) {
        selectImage(object.id);
      } else {
        activateObjectKey(pptxSelectionKey("image", object.id));
      }
    } else if (objectKind === "table") {
      if (!selectedObjectKeySet.has(pptxSelectionKey("table", object.id))) {
        selectTable(object.id);
      } else {
        activateObjectKey(pptxSelectionKey("table", object.id));
      }
    } else {
      if (!selectedObjectKeySet.has(pptxSelectionKey("chart", object.id))) {
        selectChart(object.id);
      } else {
        activateObjectKey(pptxSelectionKey("chart", object.id));
      }
    }
    const dragRecords = slide
      ? pptxSlideObjectRecords(slide).filter((record) =>
          dragSelectionKeySet.has(
            pptxSelectionKey(record.objectKind, record.objectId),
          ),
        )
      : [];
    const groupItems =
      mode === "move" && dragRecords.length > 1
        ? dragRecords.map((record) => ({
            objectKind: record.objectKind,
            objectId: record.objectId,
            startX: record.object.x ?? 0,
            startY: record.object.y ?? 0,
            startWidth: record.object.width ?? 1,
            startHeight: record.object.height ?? 1,
          }))
        : undefined;
    setDragState({
      objectKind,
      objectId: object.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x ?? 10,
      startY: object.y ?? 12,
      startWidth: object.width ?? 80,
      startHeight: object.height ?? 10,
      rect,
      groupItems,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function slidePointFromPointer(
    event: ReactPointerEvent<HTMLElement>,
    rect: DOMRect,
  ) {
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    };
  }

  function selectObjectBehindPointer(
    event: ReactPointerEvent<HTMLElement>,
    clickedKey: PptxSelectionKey,
    rect: DOMRect,
  ) {
    if (!slide) return false;
    const point = slidePointFromPointer(event, rect);
    const stackedRecords = pptxSlideObjectRecords(slide)
      .filter((record) => pptxObjectContainsPoint(record, point))
      .reverse();
    if (stackedRecords.length <= 1) return false;
    const activeIndex = stackedRecords.findIndex(
      (record) =>
        pptxSelectionKey(record.objectKind, record.objectId) ===
        (activeObjectKey ?? clickedKey),
    );
    const fallbackIndex = stackedRecords.findIndex(
      (record) => pptxSelectionKey(record.objectKind, record.objectId) === clickedKey,
    );
    const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;
    const nextRecord =
      stackedRecords[(Math.max(currentIndex, 0) + 1) % stackedRecords.length];
    if (!nextRecord) return false;
    selectObject(
      nextRecord.objectKind,
      nextRecord.objectId,
      event.shiftKey || event.metaKey || event.ctrlKey,
    );
    return true;
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!slide || event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSnapGuides([]);
    const point = slidePointFromPointer(event, rect);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (!additive) clearObjectSelection();
    setSelectionBox({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      additive,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (selectionBox) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = slidePointFromPointer(event, rect);
      setSelectionBox((current) =>
        current ? { ...current, currentX: point.x, currentY: point.y } : current,
      );
      return;
    }
    if (!dragState) return;
    const deltaX = ((event.clientX - dragState.startClientX) / dragState.rect.width) * 100;
    const deltaY = ((event.clientY - dragState.startClientY) / dragState.rect.height) * 100;
    const snappingEnabled = !event.altKey && Boolean(slide);
    const ignoredSnapKeys = new Set<PptxSelectionKey>(
      dragState.groupItems
        ? dragState.groupItems.map((item) =>
            pptxSelectionKey(item.objectKind, item.objectId),
          )
        : [pptxSelectionKey(dragState.objectKind, dragState.objectId)],
    );
    const snapTargets =
      snappingEnabled && slide
        ? pptxSnapTargets(pptxSlideObjectRecords(slide), ignoredSnapKeys)
        : null;
    const updateObject =
      dragState.objectKind === "text"
        ? updateTextById
        : dragState.objectKind === "shape"
          ? updateShapeById
          : dragState.objectKind === "image"
            ? updateImageById
            : dragState.objectKind === "table"
              ? updateTableById
              : updateChartById;
    if (dragState.groupItems && dragState.mode === "move") {
      const movedBounds = pptxBoundsFromItems(
        dragState.groupItems.map((item) => ({
          x: item.startX + deltaX,
          y: item.startY + deltaY,
          width: item.startWidth,
          height: item.startHeight,
        })),
      );
      const snapDelta =
        movedBounds && snapTargets
          ? pptxMoveSnap(movedBounds, snapTargets)
          : { deltaX: 0, deltaY: 0, guides: [] };
      const snappedDeltaX = deltaX + snapDelta.deltaX;
      const snappedDeltaY = deltaY + snapDelta.deltaY;
      const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
      dragState.groupItems.forEach((item) => {
        patches.set(pptxSelectionKey(item.objectKind, item.objectId), {
          x: clampPercent(item.startX + snappedDeltaX),
          y: clampPercent(item.startY + snappedDeltaY),
        });
      });
      setSnapGuides(snapDelta.guides);
      updateObjectGeometries(patches);
    } else if (dragState.mode === "move") {
      const movedBounds = {
        x: dragState.startX + deltaX,
        y: dragState.startY + deltaY,
        width: dragState.startWidth,
        height: dragState.startHeight,
      };
      const snapDelta = snapTargets
        ? pptxMoveSnap(movedBounds, snapTargets)
        : { deltaX: 0, deltaY: 0, guides: [] };
      setSnapGuides(snapDelta.guides);
      updateObject(dragState.objectId, {
        x: clampPercent(dragState.startX + deltaX + snapDelta.deltaX),
        y: clampPercent(dragState.startY + deltaY + snapDelta.deltaY),
      });
    } else {
      const minHeight = dragState.objectKind === "shape" ? 0 : 4;
      const nextSize = event.shiftKey
        ? lockedAspectResize(dragState, deltaX, deltaY, minHeight)
        : {
            width: clampPercent(dragState.startWidth + deltaX, 4, 100),
            height: clampPercent(dragState.startHeight + deltaY, minHeight, 100),
          };
      const ratio = event.shiftKey
        ? dragState.startWidth / Math.max(dragState.startHeight, 1)
        : undefined;
      const snappedSize = snapTargets
        ? pptxResizeSnap(
            {
              x: dragState.startX,
              y: dragState.startY,
              width: nextSize.width,
              height: nextSize.height,
            },
            snapTargets,
            minHeight,
            ratio,
            Math.abs(deltaX) >= Math.abs(deltaY),
          )
        : { ...nextSize, guides: [] };
      setSnapGuides(snappedSize.guides);
      updateObject(dragState.objectId, {
        width: snappedSize.width,
        height: snappedSize.height,
      });
    }
  }

  function handleCanvasPointerUp() {
    if (selectionBox && slide) {
      const bounds = pptxSelectionBoxBounds(selectionBox);
      if (bounds.width < 0.5 && bounds.height < 0.5) {
        if (!selectionBox.additive) clearObjectSelection();
      } else {
        const matchedKeys = pptxSlideObjectRecords(slide)
          .filter((record) => pptxObjectIntersectsSelectionBox(record, bounds))
          .map((record) => pptxSelectionKey(record.objectKind, record.objectId));
        const expandedKeys = expandGroupedSelectionKeys(matchedKeys);
        const nextKeys = selectionBox.additive
          ? Array.from(new Set([...selectedObjectKeys, ...expandedKeys]))
          : expandedKeys;
        setSelectedObjectKeys(nextKeys);
        activateObjectKey(nextKeys.at(-1) ?? null);
      }
      setSelectionBox(null);
    }
    setSnapGuides([]);
    setDragState(null);
  }

  function movePresentation(delta: -1 | 1) {
    setPresentingIndex((current) => {
      if (current === null) return current;
      return nextVisibleSlideIndex(model.slides, current + delta, delta);
    });
  }

  function handlePresentationKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setPresentingIndex(null);
    } else if (
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === " " ||
      event.key === "PageDown"
    ) {
      event.preventDefault();
      movePresentation(1);
    } else if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp" ||
      event.key === "PageUp"
    ) {
      event.preventDefault();
      movePresentation(-1);
    }
  }

  function handleTextKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!activeObject) return;
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelectedObjects();
      return;
    }
    if (primary && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) {
        ungroupSelectedObjects();
      } else {
        groupSelectedObjects();
      }
      return;
    }
    const updateActiveObject = activeText
      ? updateActiveText
      : activeShape
        ? updateActiveShape
        : activeImage
          ? updateActiveImage
          : activeTable
            ? updateActiveTable
            : updateActiveChart;
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (hasMultiSelection) {
        moveSelectedObjects(-step, 0);
        return;
      }
      updateActiveObject({ x: Math.max((activeObject.x ?? 10) - step, 0) });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (hasMultiSelection) {
        moveSelectedObjects(step, 0);
        return;
      }
      updateActiveObject({ x: Math.min((activeObject.x ?? 10) + step, 100) });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hasMultiSelection) {
        moveSelectedObjects(0, -step);
        return;
      }
      updateActiveObject({ y: Math.max((activeObject.y ?? 12) - step, 0) });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hasMultiSelection) {
        moveSelectedObjects(0, step);
        return;
      }
      updateActiveObject({ y: Math.min((activeObject.y ?? 12) + step, 100) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelectedObjects();
    }
  }

  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) {
        ungroupSelectedObjects();
      } else {
        groupSelectedObjects();
      }
    } else if (primary && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllSlideObjects();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearObjectSelection();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelectedObjects();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PptxEditorToolbar
        model={model}
        slide={slide}
        activeText={activeText}
        activeShape={activeShape}
        activeImage={activeImage}
        activeTable={activeTable}
        activeChart={activeChart}
        activeObject={activeObject}
        activeLayerIndex={activeLayerIndex}
        activeLayerLength={activeLayerLength}
        hasObjectSelection={hasObjectSelection}
        hasMultiSelection={hasMultiSelection}
        selectedObjectCount={selectedObjects.length}
        canUngroupSelection={hasGroupedSelection}
        imageInputRef={imageInputRef}
        onAddSlide={addSlide}
        onDuplicateSlide={duplicateSlide}
        onMoveSlide={moveSlide}
        onDeleteSlide={deleteSlide}
        onToggleSlideHidden={toggleSlideHidden}
        onPresentBeginning={() => setPresentingIndex(firstVisibleSlideIndex(model.slides))}
        onPresentCurrent={() =>
          setPresentingIndex(nextVisibleSlideIndex(model.slides, slideIndex, 1, true))
        }
        onAddTextBox={addTextBox}
        onAddShape={addShape}
        onAddImageFile={addImageFile}
        onSetSlideBackgroundImage={setSlideBackgroundImage}
        onAddTable={addTable}
        onDuplicateSelectedObjects={duplicateSelectedObjects}
        onDeleteSelectedObjects={deleteSelectedObjects}
        onGroupSelectedObjects={groupSelectedObjects}
        onUngroupSelectedObjects={ungroupSelectedObjects}
        onMoveActiveObjectLayer={moveActiveObjectLayer}
        onAlignActiveObject={alignActiveObject}
        onDistributeSelectedObjects={distributeSelectedObjects}
        onUpdateSlide={updateSlide}
        onUpdateActiveText={updateActiveText}
        onUpdateActiveShape={updateActiveShape}
        onUpdateActiveImage={updateActiveImage}
        onUpdateActiveTable={updateActiveTable}
        onUpdateActiveChart={updateActiveChart}
      />
      {presentingSlide && presentingIndex !== null && (
        <PptxPresentationOverlay
          slides={model.slides}
          presentingIndex={presentingIndex}
          presentingSlide={presentingSlide}
          onMove={movePresentation}
          onClose={() => setPresentingIndex(null)}
          onKeyDown={handlePresentationKeyDown}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <PptxSlideNavigator
          slides={model.slides}
          activeSlideId={slide?.id}
          slideLabel={(index) =>
            t("documentEditor.slideLabel", { index: index + 1 })
          }
          onSelect={(slideId) => {
            setPreferredSlideId(slideId);
            clearObjectSelection();
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface)]">
          <PptxSlideCanvas
            canvasRef={canvasRef}
            slide={slide}
            selectionBoxBounds={selectionBoxBounds}
            snapGuides={snapGuides}
            showSnapGrid={Boolean(dragState)}
            activeTextId={activeTextId}
            activeShapeId={activeShapeId}
            activeImageId={activeImageId}
            activeTableId={activeTableId}
            activeChartId={activeChartId}
            selectedKeys={selectedObjectKeySet}
            onCanvasKeyDown={handleCanvasKeyDown}
            onCanvasPointerMove={handleCanvasPointerMove}
            onCanvasPointerUp={handleCanvasPointerUp}
            onCanvasPointerDown={handleCanvasPointerDown}
            onTextKeyDown={handleTextKeyDown}
            onSelectText={selectText}
            onSelectShape={selectShape}
            onSelectImage={selectImage}
            onSelectTable={selectTable}
            onSelectChart={selectChart}
            onStartObjectDrag={startObjectDrag}
            onTextChange={updateText}
            onTableCellChange={updateTableCell}
            onAddTableRow={addTableRow}
            onAddTableColumn={addTableColumn}
            onDeleteTableRow={deleteTableRow}
            onDeleteTableColumn={deleteTableColumn}
            onTableColumnWidthChange={updateTableColumnWidth}
            onTableRowHeightChange={updateTableRowHeight}
            onTableCellStyleChange={updateTableCellStyle}
            onAddSlide={addSlide}
          />
          {activeChart && (
            <PptxChartDataEditor
              chart={activeChart}
              onChartChange={updateActiveChart}
              onSeriesNameChange={updateChartSeriesName}
              onPointChange={updateChartSeriesPoint}
              onAddSeries={addChartSeries}
              onDeleteSeries={deleteChartSeries}
              onAddPoint={addChartPoint}
              onDeletePoint={deleteChartPoint}
            />
          )}
          <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] md:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr]">
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Layout</span>
              <div className="flex min-w-0 gap-1">
                <select
                  value={slide?.layoutPath ?? ""}
                  onChange={(event) => updateSlideLayout(event.target.value)}
                  disabled={!slide || (model.layouts?.length ?? 0) === 0}
                  className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {model.layouts?.length ? "No layout" : "No layout metadata"}
                  </option>
                  {slide?.layoutPath &&
                    !(model.layouts ?? []).some((layout) => layout.path === slide.layoutPath) && (
                      <option value={slide.layoutPath}>
                        {slide.layoutName ?? slide.layoutPath}
                      </option>
                    )}
                  {(model.layouts ?? []).map((layout) => (
                    <option key={layout.path} value={layout.path}>
                      {[layout.name ?? layout.path, layout.themeName]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={resetSlideLayout}
                  disabled={
                    !slide?.layoutPath ||
                    !model.layouts?.some(
                      (layout) =>
                        layout.path === slide.layoutPath &&
                        (layout.placeholderTexts?.length ?? 0) > 0,
                    )
                  }
                  className="h-8 shrink-0 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Transition</span>
              <select
                value={slide?.transition?.type ?? "none"}
                onChange={(event) =>
                  updateSlideTransition({
                    type: event.target.value as PptxTransition["type"],
                  })
                }
                disabled={!slide}
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {["none", "fade", "push", "wipe", "split", "cut", "cover", "uncover", "zoom"].map(
                  (transition) => (
                    <option key={transition} value={transition}>
                      {transition}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Speed</span>
              <select
                value={slide?.transition?.speed ?? "med"}
                onChange={(event) =>
                  updateSlideTransition({
                    speed: event.target.value as PptxTransition["speed"],
                  })
                }
                disabled={!slide || (slide.transition?.type ?? "none") === "none"}
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {["fast", "med", "slow"].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Direction</span>
              <select
                value={slide?.transition?.direction ?? "l"}
                onChange={(event) =>
                  updateSlideTransition({ direction: event.target.value })
                }
                disabled={
                  !slide ||
                  !["push", "wipe", "split", "cover", "uncover", "zoom"].includes(
                    slide.transition?.type ?? "none",
                  )
                }
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {[
                  ["l", "left"],
                  ["r", "right"],
                  ["u", "up"],
                  ["d", "down"],
                  ["in", "in"],
                  ["out", "out"],
                  ["horz", "horizontal"],
                  ["vert", "vertical"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1 text-xs text-[var(--text)]">
              <input
                type="checkbox"
                checked={slide?.transition?.advanceOnClick ?? true}
                onChange={(event) =>
                  updateSlideTransition({ advanceOnClick: event.target.checked })
                }
                disabled={!slide || (slide.transition?.type ?? "none") === "none"}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              On click
            </label>
            <label className="grid gap-1">
              <span className="font-medium uppercase tracking-wide">Auto ms</span>
              <input
                type="number"
                min={0}
                max={600000}
                step={500}
                value={slide?.transition?.advanceAfterMs ?? 0}
                onChange={(event) =>
                  updateSlideTransition({
                    advanceAfterMs: Math.max(0, Number(event.target.value) || 0),
                  })
                }
                disabled={!slide || (slide.transition?.type ?? "none") === "none"}
                className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          </div>
          <PptxThemeEditor
            theme={activeTheme}
            disabled={!activeTheme}
            onThemeChange={(patch) => {
              if (!activeTheme) return;
              updateTheme(activeTheme.path, patch);
            }}
            onThemeColorChange={(key, color) => {
              if (!activeTheme) return;
              updateThemeColor(activeTheme.path, key, color);
            }}
          />
          <PptxAnimationInspector
            animations={slide?.animations ?? []}
            disabled={!slide}
            onTimingChange={updateAnimationTiming}
            onMove={moveAnimation}
          />
          <PptxMediaInspector
            media={slide?.media ?? []}
            disabled={!slide}
            onChange={updateMediaById}
          />
          <label className="block shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Speaker notes
            </span>
            <textarea
              value={slide?.notes ?? ""}
              onChange={(event) => updateSlideNotes(event.target.value)}
              disabled={!slide}
              placeholder="Notes for this slide"
              className="h-24 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>
        {slide && (
          <PptxObjectLayerPanel
            slide={slide}
            activeKey={activeObjectKey}
            selectedKeys={selectedObjectKeySet}
            onSelect={selectObject}
            onMove={(objectKind, objectId, direction) =>
              moveObjectLayer(pptxSelectionKey(objectKind, objectId), direction)
            }
          />
        )}
      </div>
    </div>
  );
}
