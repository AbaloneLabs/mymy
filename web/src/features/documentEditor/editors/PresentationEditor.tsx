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
  nextPptxImageId,
  nextPptxShapeId,
  nextPptxSlidePath,
  nextPptxTableId,
  nextPptxTextId,
  nextVisibleSlideIndex,
  reorderPptxObjectsById,
} from "../pptxEditorUtils";
import type { SlideDragState } from "../pptxEditorUtils";
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
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
  PptxTransition,
} from "../models";
import {
  PptxAnimationInspector,
  PptxChartDataEditor,
  PptxObjectLayerPanel,
  PptxPresentationOverlay,
  PptxSlideNavigator,
} from "../pptxEditorPanels";
import { PptxEditorToolbar } from "../pptxEditorToolbar";
import { PptxSlideCanvas } from "../pptxSlideCanvas";

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
  const [presentingIndex, setPresentingIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const slide =
    model.slides.find((item) => item.id === preferredSlideId) ?? model.slides[0];
  const slideIndex = slide
    ? Math.max(0, model.slides.findIndex((item) => item.id === slide.id))
    : 0;
  const presentingSlide =
    presentingIndex === null ? null : model.slides[presentingIndex] ?? null;
  const activeText = slide?.texts.find((item) => item.id === activeTextId);
  const activeShape = slide?.shapes?.find((item) => item.id === activeShapeId);
  const activeImage = slide?.images?.find((item) => item.id === activeImageId);
  const activeTable = slide?.tables?.find((item) => item.id === activeTableId);
  const activeChart = slide?.charts?.find((item) => item.id === activeChartId);
  const activeTextIndex = slide?.texts.findIndex((item) => item.id === activeTextId) ?? -1;
  const activeShapeIndex =
    slide?.shapes?.findIndex((item) => item.id === activeShapeId) ?? -1;
  const activeImageIndex =
    slide?.images?.findIndex((item) => item.id === activeImageId) ?? -1;
  const activeTableIndex =
    slide?.tables?.findIndex((item) => item.id === activeTableId) ?? -1;
  const activeChartIndex =
    slide?.charts?.findIndex((item) => item.id === activeChartId) ?? -1;
  const activeObject =
    activeText ?? activeShape ?? activeImage ?? activeTable ?? activeChart;
  const activeLayerIndex = activeText
    ? activeTextIndex
    : activeShape
      ? activeShapeIndex
      : activeImage
        ? activeImageIndex
        : activeTable
          ? activeTableIndex
          : activeChart
            ? activeChartIndex
            : -1;
  const activeLayerLength = activeText
    ? (slide?.texts.length ?? 0)
    : activeShape
      ? (slide?.shapes?.length ?? 0)
      : activeImage
        ? (slide?.images?.length ?? 0)
        : activeTable
          ? (slide?.tables?.length ?? 0)
          : activeChart
            ? (slide?.charts?.length ?? 0)
            : 0;
  const selectedObjectKeySet = new Set(selectedObjectKeys);
  const selectedObjects = slide
    ? pptxSlideObjectRecords(slide).filter((record) =>
        selectedObjectKeySet.has(
          pptxSelectionKey(record.objectKind, record.objectId),
        ),
      )
    : [];
  const activeObjectKey = activeText
    ? pptxSelectionKey("text", activeText.id)
    : activeShape
      ? pptxSelectionKey("shape", activeShape.id)
      : activeImage
        ? pptxSelectionKey("image", activeImage.id)
        : activeTable
          ? pptxSelectionKey("table", activeTable.id)
          : activeChart
            ? pptxSelectionKey("chart", activeChart.id)
            : null;
  const hasObjectSelection = selectedObjects.length > 0;
  const hasMultiSelection = selectedObjects.length > 1;
  const selectionBoxBounds = selectionBox
    ? pptxSelectionBoxBounds(selectionBox)
    : null;

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

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (commandId === "newSlide") {
      addSlide();
    } else if (commandId === "duplicate") {
      if (hasObjectSelection || activeObject) {
        duplicateSelectedObjects();
      } else {
        duplicateSlide();
      }
    } else if (commandId === "delete") {
      deleteSelectedObjects();
    } else if (commandId === "sendBackward") {
      moveActiveObjectLayer(-1);
    } else if (commandId === "bringForward") {
      moveActiveObjectLayer(1);
    } else if (commandId === "alignLeft") {
      alignActiveObject("left");
    } else if (commandId === "alignCenter") {
      alignActiveObject("center");
    } else if (commandId === "alignRight") {
      alignActiveObject("right");
    } else if (commandId === "alignTop") {
      alignActiveObject("top");
    } else if (commandId === "alignMiddle") {
      alignActiveObject("middle");
    } else if (commandId === "alignBottom") {
      alignActiveObject("bottom");
    } else if (commandId === "distributeHorizontal") {
      distributeSelectedObjects("horizontal");
    } else if (commandId === "distributeVertical") {
      distributeSelectedObjects("vertical");
    } else if (commandId === "present") {
      setPresentingIndex(nextVisibleSlideIndex(model.slides, slideIndex, 1, true));
    } else if (commandId === "insertTable") {
      addTable();
    } else {
      return false;
    }
    return true;
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

  function selectObject(
    objectKind: PptxObjectKind,
    objectId: string,
    additive = false,
  ) {
    const key = pptxSelectionKey(objectKind, objectId);
    if (!additive) {
      activateObjectKey(key);
      setSelectedObjectKeys([key]);
      return;
    }
    const exists = selectedObjectKeys.includes(key);
    const next = exists
      ? selectedObjectKeys.filter((item) => item !== key)
      : [...selectedObjectKeys, key];
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
      slides: model.slides.map((item) =>
        item.id === slide.id ? { ...item, ...patch } : item,
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
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, tables: updater(item.tables ?? []) }
          : item,
      ),
    });
  }

  function updateSlideImages(
    slideId: string,
    updater: (images: PptxImage[]) => PptxImage[],
  ) {
    onChange({
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
      slides: model.slides.map((item) =>
        item.id === slideId
          ? { ...item, charts: updater(item.charts ?? []) }
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

  function updateTableById(tableId: string, patch: Partial<PptxTable>) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId ? { ...table, ...patch } : table,
      ),
    );
  }

  function updateTableCell(
    tableId: string,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId) return table;
        return {
          ...table,
          rows: table.rows.map((row, currentRowIndex) =>
            currentRowIndex === rowIndex
              ? row.map((cell, currentColumnIndex) =>
                  currentColumnIndex === columnIndex ? value : cell,
                )
              : row,
          ),
        };
      }),
    );
  }

  function addTableRow(tableId: string, afterRowIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId) return table;
        const columnCount = Math.max(
          1,
          ...table.rows.map((row) => row.length),
        );
        const nextRows = table.rows.map((row) => [...row]);
        nextRows.splice(afterRowIndex + 1, 0, Array(columnCount).fill(""));
        return { ...table, rows: nextRows };
      }),
    );
  }

  function addTableColumn(tableId: string, afterColumnIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              rows: table.rows.map((row) => {
                const nextRow = [...row];
                nextRow.splice(afterColumnIndex + 1, 0, "");
                return nextRow;
              }),
            }
          : table,
      ),
    );
  }

  function deleteTableRow(tableId: string, rowIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId && table.rows.length > 1
          ? {
              ...table,
              rows: table.rows.filter(
                (_row, currentRowIndex) => currentRowIndex !== rowIndex,
              ),
            }
          : table,
      ),
    );
  }

  function deleteTableColumn(tableId: string, columnIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId) return table;
        const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
        if (columnCount <= 1) return table;
        return {
          ...table,
          rows: table.rows.map((row) =>
            row.filter((_cell, currentColumnIndex) => currentColumnIndex !== columnIndex),
          ),
        };
      }),
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
    const rowCount = Math.max(
      activeChart.categories?.length ?? 0,
      ...(activeChart.series ?? []).map((series) =>
        Math.max(series.categories?.length ?? 0, series.values?.length ?? 0),
      ),
      1,
    );
    updateActiveChart({
      series: [
        ...(activeChart.series ?? []),
        {
          name: `Series ${(activeChart.series ?? []).length + 1}`,
          categories: Array.from({ length: rowCount }, (_, index) =>
            activeChart.categories?.[index] ?? `Category ${index + 1}`,
          ),
          values: Array.from({ length: rowCount }, () => "0"),
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
        const pointIndex = Math.max(
          series.categories?.length ?? 0,
          series.values?.length ?? 0,
          activeChart.categories?.length ?? 0,
        );
        return {
          ...series,
          categories: [
            ...(series.categories ?? activeChart.categories ?? []),
            `Category ${pointIndex + 1}`,
          ],
          values: [...(series.values ?? []), "0"],
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
    onChange({ slides: [...model.slides, next] });
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
    onChange({ slides: [...model.slides, next] });
    setPreferredSlideId(next.id);
    selectText(next.texts[0]?.id ?? null);
  }

  function deleteSlide() {
    if (!slide || model.slides.length <= 1) return;
    const nextSlides = model.slides.filter((item) => item.id !== slide.id);
    onChange({ slides: nextSlides });
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
    onChange({ slides });
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
    const next: PptxShape = {
      id: nextPptxShapeId(slide.shapes ?? []),
      kind,
      x: kind === "line" ? 22 : 24,
      y: kind === "line" ? 50 : 34,
      width: kind === "line" ? 52 : 26,
      height: kind === "line" ? 0 : 20,
      rotation: 0,
      fillColor: kind === "line" ? undefined : "#dbeafe",
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
      rows: [
        ["Header 1", "Header 2", "Header 3"],
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
          altText: file.name.replace(/\.[^.]+$/, "") || "Image",
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

  function duplicateActiveText() {
    if (!slide || !activeText) return;
    const next = {
      ...activeText,
      id: nextPptxTextId(slide.texts),
      x: Math.min((activeText.x ?? 10) + 2, 100),
      y: Math.min((activeText.y ?? 12) + 2, 100),
    };
    updateSlideTexts(slide.id, (texts) => [...texts, next]);
    selectText(next.id);
  }

  function duplicateActiveShape() {
    if (!slide || !activeShape) return;
    const next = {
      ...activeShape,
      id: nextPptxShapeId(slide.shapes ?? []),
      x: Math.min((activeShape.x ?? 24) + 2, 100),
      y: Math.min((activeShape.y ?? 34) + 2, 100),
    };
    updateSlideShapes(slide.id, (shapes) => [...shapes, next]);
    selectShape(next.id);
  }

  function duplicateActiveImage() {
    if (!slide || !activeImage) return;
    const next = {
      ...activeImage,
      id: nextPptxImageId(slide.images ?? []),
      relationshipId: undefined,
      x: Math.min((activeImage.x ?? 24) + 2, 100),
      y: Math.min((activeImage.y ?? 34) + 2, 100),
    };
    updateSlideImages(slide.id, (images) => [...images, next]);
    selectImage(next.id);
  }

  function duplicateActiveTable() {
    if (!slide || !activeTable) return;
    const next = {
      ...activeTable,
      id: nextPptxTableId(slide.tables ?? []),
      x: Math.min((activeTable.x ?? 18) + 2, 100),
      y: Math.min((activeTable.y ?? 30) + 2, 100),
      rows: activeTable.rows.map((row) => [...row]),
    };
    updateSlideTables(slide.id, (tables) => [...tables, next]);
    selectTable(next.id);
  }

  function duplicateActiveChart() {
    if (!slide || !activeChart) return;
    const next = {
      ...activeChart,
      id: nextPptxChartId(slide.charts ?? []),
      relationshipId: undefined,
      x: Math.min((activeChart.x ?? 18) + 2, 100),
      y: Math.min((activeChart.y ?? 18) + 2, 100),
      series: (activeChart.series ?? []).map((series) => ({
        ...series,
        categories: series.categories ? [...series.categories] : undefined,
        values: series.values ? [...series.values] : undefined,
      })),
      categories: activeChart.categories ? [...activeChart.categories] : undefined,
    };
    updateSlideCharts(slide.id, (charts) => [...charts, next]);
    selectChart(next.id);
  }

  function duplicateActiveObject() {
    if (activeText) {
      duplicateActiveText();
    } else if (activeShape) {
      duplicateActiveShape();
    } else if (activeImage) {
      duplicateActiveImage();
    } else if (activeTable) {
      duplicateActiveTable();
    } else if (activeChart) {
      duplicateActiveChart();
    }
  }

  function deleteActiveText() {
    if (!slide || !activeText) return;
    updateSlideTexts(slide.id, (texts) =>
      texts.filter((textItem) => textItem.id !== activeText.id),
    );
    setActiveTextId(null);
  }

  function deleteActiveShape() {
    if (!slide || !activeShape) return;
    updateSlideShapes(slide.id, (shapes) =>
      shapes.filter((shape) => shape.id !== activeShape.id),
    );
    setActiveShapeId(null);
  }

  function deleteActiveImage() {
    if (!slide || !activeImage) return;
    updateSlideImages(slide.id, (images) =>
      images.filter((image) => image.id !== activeImage.id),
    );
    setActiveImageId(null);
  }

  function deleteActiveTable() {
    if (!slide || !activeTable) return;
    updateSlideTables(slide.id, (tables) =>
      tables.filter((table) => table.id !== activeTable.id),
    );
    setActiveTableId(null);
  }

  function deleteActiveChart() {
    if (!slide || !activeChart) return;
    updateSlideCharts(slide.id, (charts) =>
      charts.filter((chart) => chart.id !== activeChart.id),
    );
    setActiveChartId(null);
  }

  function deleteActiveObject() {
    if (activeText) {
      deleteActiveText();
    } else if (activeShape) {
      deleteActiveShape();
    } else if (activeImage) {
      deleteActiveImage();
    } else if (activeTable) {
      deleteActiveTable();
    } else if (activeChart) {
      deleteActiveChart();
    }
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
    const nextKeys: PptxSelectionKey[] = [];
    const nextTexts = [...slide.texts];
    const nextShapes = [...(slide.shapes ?? [])];
    const nextImages = [...(slide.images ?? [])];
    const nextTables = [...(slide.tables ?? [])];
    const nextCharts = [...(slide.charts ?? [])];

    selectedObjects.forEach((record) => {
      if (record.objectKind === "text") {
        const source = record.object as PptxText;
        const next = {
          ...source,
          id: nextPptxTextId(nextTexts),
          x: Math.min((source.x ?? 10) + 2, 100),
          y: Math.min((source.y ?? 12) + 2, 100),
        };
        nextTexts.push(next);
        nextKeys.push(pptxSelectionKey("text", next.id));
      } else if (record.objectKind === "shape") {
        const source = record.object as PptxShape;
        const next = {
          ...source,
          id: nextPptxShapeId(nextShapes),
          x: Math.min((source.x ?? 24) + 2, 100),
          y: Math.min((source.y ?? 34) + 2, 100),
        };
        nextShapes.push(next);
        nextKeys.push(pptxSelectionKey("shape", next.id));
      } else if (record.objectKind === "image") {
        const source = record.object as PptxImage;
        const next = {
          ...source,
          id: nextPptxImageId(nextImages),
          relationshipId: undefined,
          x: Math.min((source.x ?? 24) + 2, 100),
          y: Math.min((source.y ?? 34) + 2, 100),
        };
        nextImages.push(next);
        nextKeys.push(pptxSelectionKey("image", next.id));
      } else if (record.objectKind === "table") {
        const source = record.object as PptxTable;
        const next = {
          ...source,
          id: nextPptxTableId(nextTables),
          x: Math.min((source.x ?? 18) + 2, 100),
          y: Math.min((source.y ?? 30) + 2, 100),
          rows: source.rows.map((row) => [...row]),
        };
        nextTables.push(next);
        nextKeys.push(pptxSelectionKey("table", next.id));
      } else {
        const source = record.object as PptxChart;
        const next = {
          ...source,
          id: nextPptxChartId(nextCharts),
          relationshipId: undefined,
          x: Math.min((source.x ?? 18) + 2, 100),
          y: Math.min((source.y ?? 18) + 2, 100),
          series: (source.series ?? []).map((series) => ({
            ...series,
            categories: series.categories ? [...series.categories] : undefined,
            values: series.values ? [...series.values] : undefined,
          })),
          categories: source.categories ? [...source.categories] : undefined,
        };
        nextCharts.push(next);
        nextKeys.push(pptxSelectionKey("chart", next.id));
      }
    });

    onChange({
      slides: model.slides.map((item) =>
        item.id === slide.id
          ? {
              ...item,
              texts: nextTexts,
              shapes: nextShapes,
              images: nextImages,
              tables: nextTables,
              charts: nextCharts,
            }
          : item,
      ),
    });
    setSelectedObjectKeys(nextKeys);
    activateObjectKey(nextKeys.at(-1) ?? null);
  }

  function deleteSelectedObjects() {
    if (!slide || selectedObjects.length <= 1) {
      deleteActiveObject();
      return;
    }
    const keys = new Set(selectedObjectKeys);
    onChange({
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
    const clickedKey = pptxSelectionKey(objectKind, object.id);
    const groupItems =
      mode === "move" &&
      selectedObjectKeySet.has(clickedKey) &&
      selectedObjects.length > 1
        ? selectedObjects.map((record) => ({
            objectKind: record.objectKind,
            objectId: record.objectId,
            startX: record.object.x ?? 0,
            startY: record.object.y ?? 0,
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
    event: ReactPointerEvent<HTMLDivElement>,
    rect: DOMRect,
  ) {
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!slide || event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
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
      const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
      dragState.groupItems.forEach((item) => {
        patches.set(pptxSelectionKey(item.objectKind, item.objectId), {
          x: clampPercent(item.startX + deltaX),
          y: clampPercent(item.startY + deltaY),
        });
      });
      updateObjectGeometries(patches);
    } else if (dragState.mode === "move") {
      updateObject(dragState.objectId, {
        x: clampPercent(dragState.startX + deltaX),
        y: clampPercent(dragState.startY + deltaY),
      });
    } else {
      const minHeight = dragState.objectKind === "shape" ? 0 : 4;
      const nextSize = event.shiftKey
        ? lockedAspectResize(dragState, deltaX, deltaY, minHeight)
        : {
            width: clampPercent(dragState.startWidth + deltaX, 4, 100),
            height: clampPercent(dragState.startHeight + deltaY, minHeight, 100),
          };
      updateObject(dragState.objectId, nextSize);
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
        const nextKeys = selectionBox.additive
          ? Array.from(new Set([...selectedObjectKeys, ...matchedKeys]))
          : matchedKeys;
        setSelectedObjectKeys(nextKeys);
        activateObjectKey(nextKeys.at(-1) ?? null);
      }
      setSelectionBox(null);
    }
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
    if (primary && event.key.toLowerCase() === "a") {
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
        onAddTable={addTable}
        onDuplicateSelectedObjects={duplicateSelectedObjects}
        onDeleteSelectedObjects={deleteSelectedObjects}
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
            onAddSlide={addSlide}
          />
          {activeChart && (
            <PptxChartDataEditor
              chart={activeChart}
              onSeriesNameChange={updateChartSeriesName}
              onPointChange={updateChartSeriesPoint}
              onAddSeries={addChartSeries}
              onDeleteSeries={deleteChartSeries}
              onAddPoint={addChartPoint}
              onDeletePoint={deleteChartPoint}
            />
          )}
          <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] md:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
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
          <PptxAnimationInspector
            animations={slide?.animations ?? []}
            disabled={!slide}
            onTimingChange={updateAnimationTiming}
            onMove={moveAnimation}
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
