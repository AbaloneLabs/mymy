import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  EyeOff,
  Image as ImageIcon,
  Italic,
  Minus,
  Move,
  Play,
  Plus,
  RotateCw,
  SendToBack,
  Square,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Type,
  Underline,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import { builtInFontFamilies } from "../fonts";
import {
  SLIDE_ASPECT_RATIO,
  animationLabel,
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
  normalizeRotation,
  pptxChartStyle,
  pptxImageStyle,
  pptxTableStyle,
} from "../pptxEditorUtils";
import type { SlideDragState } from "../pptxEditorUtils";
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
import { FontFamilySelect, ToolbarButton } from "../shared";

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
  const [dragState, setDragState] = useState<SlideDragState | null>(null);
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
      if (activeObject) {
        duplicateActiveObject();
      } else {
        duplicateSlide();
      }
    } else if (commandId === "delete") {
      deleteActiveObject();
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

  function selectText(textId: string | null) {
    setActiveTextId(textId);
    if (textId) {
      setActiveShapeId(null);
      setActiveImageId(null);
      setActiveTableId(null);
      setActiveChartId(null);
    }
  }

  function selectShape(shapeId: string | null) {
    setActiveShapeId(shapeId);
    if (shapeId) {
      setActiveTextId(null);
      setActiveImageId(null);
      setActiveTableId(null);
      setActiveChartId(null);
    }
  }

  function selectImage(imageId: string | null) {
    setActiveImageId(imageId);
    if (imageId) {
      setActiveTextId(null);
      setActiveShapeId(null);
      setActiveTableId(null);
      setActiveChartId(null);
    }
  }

  function selectTable(tableId: string | null) {
    setActiveTableId(tableId);
    if (tableId) {
      setActiveTextId(null);
      setActiveShapeId(null);
      setActiveImageId(null);
      setActiveChartId(null);
    }
  }

  function selectChart(chartId: string | null) {
    setActiveChartId(chartId);
    if (chartId) {
      setActiveTextId(null);
      setActiveShapeId(null);
      setActiveImageId(null);
      setActiveTableId(null);
    }
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
    selectText(null);
    setActiveShapeId(null);
    setActiveImageId(null);
    setActiveTableId(null);
    setActiveChartId(null);
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

  function moveActiveTextLayer(direction: -1 | 1) {
    if (!slide || !activeText) return;
    const index = slide.texts.findIndex((text) => text.id === activeText.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= slide.texts.length) return;
    updateSlideTexts(slide.id, (texts) => {
      const next = [...texts];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function moveActiveShapeLayer(direction: -1 | 1) {
    if (!slide || !activeShape) return;
    const shapes = slide.shapes ?? [];
    const index = shapes.findIndex((shape) => shape.id === activeShape.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= shapes.length) return;
    updateSlideShapes(slide.id, (items) => {
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function moveActiveImageLayer(direction: -1 | 1) {
    if (!slide || !activeImage) return;
    const images = slide.images ?? [];
    const index = images.findIndex((image) => image.id === activeImage.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= images.length) return;
    updateSlideImages(slide.id, (items) => {
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function moveActiveTableLayer(direction: -1 | 1) {
    if (!slide || !activeTable) return;
    const tables = slide.tables ?? [];
    const index = tables.findIndex((table) => table.id === activeTable.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= tables.length) return;
    updateSlideTables(slide.id, (items) => {
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function moveActiveChartLayer(direction: -1 | 1) {
    if (!slide || !activeChart) return;
    const charts = slide.charts ?? [];
    const index = charts.findIndex((chart) => chart.id === activeChart.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= charts.length) return;
    updateSlideCharts(slide.id, (items) => {
      const next = [...items];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function moveActiveObjectLayer(direction: -1 | 1) {
    if (activeText) {
      moveActiveTextLayer(direction);
    } else if (activeShape) {
      moveActiveShapeLayer(direction);
    } else if (activeImage) {
      moveActiveImageLayer(direction);
    } else if (activeTable) {
      moveActiveTableLayer(direction);
    } else if (activeChart) {
      moveActiveChartLayer(direction);
    }
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

  function alignActiveObject(
    edge: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) {
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
      selectText(object.id);
    } else if (objectKind === "shape") {
      selectShape(object.id);
    } else if (objectKind === "image") {
      selectImage(object.id);
    } else if (objectKind === "table") {
      selectTable(object.id);
    } else {
      selectChart(object.id);
    }
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
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
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
    if (dragState.mode === "move") {
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
      duplicateActiveObject();
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
      updateActiveObject({ x: Math.max((activeObject.x ?? 10) - step, 0) });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateActiveObject({ x: Math.min((activeObject.x ?? 10) + step, 100) });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveObject({ y: Math.max((activeObject.y ?? 12) - step, 0) });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveObject({ y: Math.min((activeObject.y ?? 12) + step, 100) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteActiveObject();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={addSlide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          New slide
        </button>
        <button
          type="button"
          onClick={duplicateSlide}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          Duplicate slide
        </button>
        <button
          type="button"
          onClick={() => moveSlide(-1)}
          disabled={!slide || model.slides[0]?.id === slide.id}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Move slide up"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => moveSlide(1)}
          disabled={!slide || model.slides.at(-1)?.id === slide.id}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Move slide down"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={deleteSlide}
          disabled={!slide || model.slides.length <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Delete slide"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={toggleSlideHidden}
          disabled={!slide}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40",
            slide?.hidden && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={slide?.hidden ? "Unhide slide" : "Hide slide"}
        >
          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          {slide?.hidden ? "Hidden" : "Hide"}
        </button>
        <button
          type="button"
          onClick={() => setPresentingIndex(firstVisibleSlideIndex(model.slides))}
          disabled={model.slides.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Present from beginning"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
          Present
        </button>
        <button
          type="button"
          onClick={() =>
            setPresentingIndex(
              nextVisibleSlideIndex(model.slides, slideIndex, 1, true),
            )
          }
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Present current slide"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
          Current
        </button>
        <button
          type="button"
          onClick={addTextBox}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <Type className="h-3.5 w-3.5" strokeWidth={1.75} />
          Text box
        </button>
        <button
          type="button"
          onClick={() => addShape("rect")}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          Rectangle
        </button>
        <button
          type="button"
          onClick={() => addShape("ellipse")}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <Circle className="h-3.5 w-3.5" strokeWidth={1.75} />
          Ellipse
        </button>
        <button
          type="button"
          onClick={() => addShape("line")}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Line
        </button>
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          Image
        </button>
        <button
          type="button"
          onClick={addTable}
          disabled={!slide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <TableIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          Table
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) addImageFile(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={duplicateActiveObject}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Duplicate selected object"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={deleteActiveObject}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Delete selected object"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => moveActiveObjectLayer(-1)}
          disabled={!activeObject || activeLayerIndex <= 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Send backward"
        >
          <SendToBack className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => moveActiveObjectLayer(1)}
          disabled={
            !activeObject ||
            !slide ||
            activeLayerIndex >= activeLayerLength - 1
          }
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Bring forward"
        >
          <BringToFront className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("left")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to left edge"
        >
          <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("center")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to horizontal center"
        >
          <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("right")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to right edge"
        >
          <AlignRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("top")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to top edge"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("middle")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to vertical middle"
        >
          <AlignCenter className="h-3.5 w-3.5 rotate-90" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => alignActiveObject("bottom")}
          disabled={!activeObject}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Align to bottom edge"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <FontFamilySelect
          value={activeText?.fontFamily}
          onChange={(fontFamily) => updateActiveText({ fontFamily })}
          compact
        />
        <select
          value={activeText?.fontSize ?? "18"}
          onChange={(event) => updateActiveText({ fontSize: event.target.value })}
          disabled={!activeText}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        >
          {["12", "14", "16", "18", "20", "24", "28", "32", "36", "44"].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <ToolbarButton
          icon={Bold}
          label={t("documentEditor.bold")}
          onClick={() => updateActiveText({ bold: !activeText?.bold })}
          active={activeText?.bold}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={Italic}
          label={t("documentEditor.italic")}
          onClick={() => updateActiveText({ italic: !activeText?.italic })}
          active={activeText?.italic}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={Underline}
          label={t("documentEditor.underline", { defaultValue: "Underline" })}
          onClick={() => updateActiveText({ underline: !activeText?.underline })}
          active={activeText?.underline}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          onClick={() =>
            updateActiveText({ strikethrough: !activeText?.strikethrough })
          }
          active={activeText?.strikethrough}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={AlignLeft}
          label="Left"
          onClick={() => updateActiveText({ align: "left" })}
          active={!activeText?.align || activeText.align === "left"}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={AlignCenter}
          label="Center"
          onClick={() => updateActiveText({ align: "center" })}
          active={activeText?.align === "center"}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={AlignRight}
          label="Right"
          onClick={() => updateActiveText({ align: "right" })}
          active={activeText?.align === "right"}
          disabled={!activeText}
        />
        <ToolbarButton
          icon={RotateCw}
          label="Rotate"
          onClick={() =>
            activeText
              ? updateActiveText({
                  rotation: normalizeRotation((activeText.rotation ?? 0) + 15),
                })
              : activeShape
                ? updateActiveShape({
                    rotation: normalizeRotation((activeShape.rotation ?? 0) + 15),
                  })
                : activeImage
                  ? updateActiveImage({
                      rotation: normalizeRotation((activeImage.rotation ?? 0) + 15),
                    })
                  : updateActiveChart({
                      rotation: normalizeRotation((activeChart?.rotation ?? 0) + 15),
                    })
          }
          disabled={!activeObject}
        />
        <label
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
          title="Text color"
        >
          Text
          <input
            type="color"
            value={activeText?.color ?? "#111827"}
            onChange={(event) => updateActiveText({ color: event.target.value })}
            disabled={!activeText}
            className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
        </label>
        <label
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
          title="Fill color"
        >
          Fill
          <input
            type="color"
            value={activeText?.fillColor ?? activeShape?.fillColor ?? "#ffffff"}
            onChange={(event) =>
              activeText
                ? updateActiveText({ fillColor: event.target.value })
                : updateActiveShape({ fillColor: event.target.value })
            }
            disabled={(!activeText && !activeShape) || activeShape?.kind === "line"}
            className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
        </label>
        {activeShape && (
          <>
            <label
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
              title="Stroke color"
            >
              Stroke
              <input
                type="color"
                value={activeShape.strokeColor ?? "#111827"}
                onChange={(event) =>
                  updateActiveShape({ strokeColor: event.target.value })
                }
                className="h-5 w-6 cursor-pointer bg-transparent"
              />
            </label>
            <PercentInput
              label="SW"
              value={activeShape.strokeWidth ?? 2}
              min={0}
              max={12}
              onChange={(strokeWidth) => updateActiveShape({ strokeWidth })}
            />
          </>
        )}
        <label
          className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
          title="Slide background"
        >
          Slide
          <input
            type="color"
            value={slide?.backgroundColor ?? "#ffffff"}
            onChange={(event) => updateSlide({ backgroundColor: event.target.value })}
            disabled={!slide}
            className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
        </label>
        {activeObject && (
          <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            {activeImage && (
              <input
                value={activeImage.altText ?? ""}
                onChange={(event) =>
                  updateActiveImage({ altText: event.target.value })
                }
                placeholder="Alt text"
                className="h-8 w-36 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
            {activeChart && (
              <input
                value={activeChart.title ?? ""}
                onChange={(event) =>
                  updateActiveChart({ title: event.target.value })
                }
                placeholder="Chart title"
                className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}
            <PercentInput
              label="X"
              value={activeObject.x ?? 10}
              onChange={(x) =>
                activeText
                  ? updateActiveText({ x })
                  : activeShape
                    ? updateActiveShape({ x })
                    : activeImage
                      ? updateActiveImage({ x })
                      : updateActiveChart({ x })
              }
            />
            <PercentInput
              label="Y"
              value={activeObject.y ?? 12}
              onChange={(y) =>
                activeText
                  ? updateActiveText({ y })
                  : activeShape
                    ? updateActiveShape({ y })
                    : activeImage
                      ? updateActiveImage({ y })
                      : updateActiveChart({ y })
              }
            />
            <PercentInput
              label="W"
              value={activeObject.width ?? 80}
              onChange={(width) =>
                activeText
                  ? updateActiveText({ width })
                  : activeShape
                    ? updateActiveShape({ width })
                    : activeImage
                      ? updateActiveImage({ width })
                      : updateActiveChart({ width })
              }
            />
            <PercentInput
              label="H"
              value={activeObject.height ?? 10}
              onChange={(height) =>
                activeText
                  ? updateActiveText({ height })
                  : activeShape
                    ? updateActiveShape({ height })
                    : activeImage
                      ? updateActiveImage({ height })
                      : updateActiveChart({ height })
              }
            />
            <PercentInput
              label="R"
              value={activeObject.rotation ?? 0}
              min={0}
              max={359}
              onChange={(rotation) =>
                activeText
                  ? updateActiveText({ rotation })
                  : activeShape
                    ? updateActiveShape({ rotation })
                    : activeImage
                      ? updateActiveImage({ rotation })
                      : updateActiveChart({ rotation })
              }
            />
          </div>
        )}
      </div>
      {presentingSlide && presentingIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handlePresentationKeyDown}
          className="fixed inset-0 z-50 flex flex-col bg-black text-white"
          autoFocus
        >
          <div className="flex h-12 shrink-0 items-center justify-between px-4 text-xs text-white/70">
            <span>
              {presentingIndex + 1} / {model.slides.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => movePresentation(-1)}
                disabled={presentingIndex <= 0}
                className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => movePresentation(1)}
                disabled={presentingIndex >= model.slides.length - 1}
                className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => setPresentingIndex(null)}
                className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <PptxReadOnlySlide slide={presentingSlide} />
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="w-40 shrink-0 overflow-y-auto border-r border-[var(--border)] p-2">
          {model.slides.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPreferredSlideId(item.id);
                selectText(null);
                setActiveShapeId(null);
                setActiveImageId(null);
                setActiveTableId(null);
                setActiveChartId(null);
              }}
              className={cn(
                "mb-2 block w-full rounded-md border px-2 py-3 text-left text-xs",
                item.hidden && "opacity-55",
                item.id === slide?.id
                  ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                {t("documentEditor.slideLabel", { index: index + 1 })}
                {item.hidden && (
                  <span className="text-[10px] uppercase text-[var(--text-faint)]">
                    hidden
                  </span>
                )}
              </span>
              <span className="mt-2 block aspect-video rounded-sm bg-white p-1 text-[8px] leading-tight text-neutral-700 shadow-inner">
                {[
                  ...item.texts.slice(0, 2).map((text) => text.text),
                  ...(item.shapes ?? []).slice(0, 2).map((shape) => shape.kind),
                  ...(item.charts ?? []).slice(0, 1).map((chart) => chart.title ?? "Chart"),
                ].join(" / ")}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface)]">
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div
              className="mx-auto aspect-video max-w-4xl border border-[var(--border)] shadow-sm"
              style={{ backgroundColor: slide?.backgroundColor ?? "#ffffff" }}
            >
              <div
                ref={canvasRef}
                className="relative h-full w-full overflow-hidden"
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerLeave={handleCanvasPointerUp}
                onPointerDown={() => {
                  selectText(null);
                  setActiveShapeId(null);
                  setActiveImageId(null);
                  setActiveTableId(null);
                  setActiveChartId(null);
                }}
              >
                {(slide?.shapes ?? []).map((shape, index) => {
                  const selected = activeShapeId === shape.id;
                  return (
                    <div
                      key={shape.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectShape(shape.id);
                      }}
                      onKeyDown={handleTextKeyDown}
                      className={cn(
                        "absolute outline-none",
                        selected && "ring-2 ring-[var(--accent)]/40",
                      )}
                      style={{
                        left: `${shape.x ?? 24}%`,
                        top: `${shape.y ?? 34}%`,
                        width: `${shape.width ?? 26}%`,
                        height: `${shape.kind === "line" ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
                        transform: `rotate(${shape.rotation ?? 0}deg)`,
                        zIndex: index + 1,
                      }}
                    >
                      <PptxShapeView shape={shape} />
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "shape", shape, "move")
                          }
                          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
                          title="Move shape"
                        >
                          <Move className="h-3 w-3" strokeWidth={1.75} />
                          Move
                        </button>
                      )}
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "shape", shape, "resize")
                          }
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
                          title="Resize shape"
                        />
                      )}
                    </div>
                  );
                })}
                {(slide?.images ?? []).map((image, index) => {
                  const selected = activeImageId === image.id;
                  return (
                    <div
                      key={image.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectImage(image.id);
                      }}
                      onKeyDown={handleTextKeyDown}
                      className={cn(
                        "absolute outline-none",
                        selected && "ring-2 ring-[var(--accent)]/40",
                      )}
                      style={pptxImageStyle(
                        image,
                        (slide.shapes?.length ?? 0) + index + 1,
                      )}
                    >
                      <PptxImageView image={image} />
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "image", image, "move")
                          }
                          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
                          title="Move image"
                        >
                          <Move className="h-3 w-3" strokeWidth={1.75} />
                          Move
                        </button>
                      )}
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "image", image, "resize")
                          }
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
                          title="Resize image"
                        />
                      )}
                    </div>
                  );
                })}
                {(slide?.charts ?? []).map((chart, index) => {
                  const selected = activeChartId === chart.id;
                  return (
                    <div
                      key={chart.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectChart(chart.id);
                      }}
                      onKeyDown={handleTextKeyDown}
                      className={cn(
                        "absolute outline-none",
                        selected && "ring-2 ring-[var(--accent)]/40",
                      )}
                      style={pptxChartStyle(
                        chart,
                        (slide.shapes?.length ?? 0) +
                          (slide.images?.length ?? 0) +
                          index +
                          1,
                      )}
                    >
                      <PptxChartView chart={chart} />
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "chart", chart, "move")
                          }
                          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
                          title="Move chart"
                        >
                          <Move className="h-3 w-3" strokeWidth={1.75} />
                          Move
                        </button>
                      )}
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "chart", chart, "resize")
                          }
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
                          title="Resize chart"
                        />
                      )}
                    </div>
                  );
                })}
                {(slide?.tables ?? []).map((table, index) => {
                  const selected = activeTableId === table.id;
                  return (
                    <PptxEditableTable
                      key={table.id}
                      table={table}
                      selected={selected}
                      zIndex={
                        (slide.shapes?.length ?? 0) +
                        (slide.images?.length ?? 0) +
                        (slide.charts?.length ?? 0) +
                        index +
                        1
                      }
                      onSelect={() => selectTable(table.id)}
                      onStartMove={(event) =>
                        startObjectDrag(event, "table", table, "move")
                      }
                      onStartResize={(event) =>
                        startObjectDrag(event, "table", table, "resize")
                      }
                      onKeyDown={handleTextKeyDown}
                      onCellChange={(rowIndex, columnIndex, value) =>
                        updateTableCell(table.id, rowIndex, columnIndex, value)
                      }
                    />
                  );
                })}
                {slide?.texts.map((textItem, index) => {
                  const selected = activeTextId === textItem.id;
                  return (
                    <div
                      key={textItem.id}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectText(textItem.id);
                      }}
                      className={cn(
                        "absolute rounded-sm border border-transparent text-neutral-950 outline-none hover:border-neutral-300",
                        selected &&
                          "border-[var(--accent)] ring-2 ring-[var(--accent)]/30",
                      )}
                      style={{
                        left: `${textItem.x ?? 10}%`,
                        top: `${textItem.y ?? 12 + index * 18}%`,
                        width: `${textItem.width ?? 80}%`,
                        height: `${textItem.height ?? 10}%`,
                        transform: `rotate(${textItem.rotation ?? 0}deg)`,
                        zIndex:
                          (slide.shapes?.length ?? 0) +
                          (slide.images?.length ?? 0) +
                          (slide.charts?.length ?? 0) +
                          (slide.tables?.length ?? 0) +
                          index +
                          1,
                      }}
                    >
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "text", textItem, "move")
                          }
                          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
                          title="Move text box"
                        >
                          <Move className="h-3 w-3" strokeWidth={1.75} />
                          Move
                        </button>
                      )}
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        onFocus={() => selectText(textItem.id)}
                        onKeyDown={handleTextKeyDown}
                        onInput={(event) =>
                          updateText(index, event.currentTarget.textContent ?? "")
                        }
                        className="h-full min-h-8 w-full px-2 py-1 outline-none"
                        style={{
                          fontFamily:
                            textItem.fontFamily ?? builtInFontFamilies[0],
                          fontSize: `${textItem.fontSize ?? (index === 0 ? "28" : "18")}px`,
                          fontWeight: textItem.bold ? 700 : index === 0 ? 600 : 400,
                          fontStyle: textItem.italic ? "italic" : undefined,
                          textDecorationLine: [
                            textItem.underline ? "underline" : "",
                            textItem.strikethrough ? "line-through" : "",
                          ]
                            .filter(Boolean)
                            .join(" "),
                          textAlign: textItem.align ?? "left",
                          color: textItem.color,
                          backgroundColor: textItem.fillColor,
                        }}
                      >
                        {textItem.text}
                      </div>
                      {selected && (
                        <button
                          type="button"
                          onPointerDown={(event) =>
                            startObjectDrag(event, "text", textItem, "resize")
                          }
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
                          title="Resize text box"
                        />
                      )}
                    </div>
                  );
                })}
                {!slide && (
                  <button
                    type="button"
                    onClick={addSlide}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500"
                  >
                    New slide
                  </button>
                )}
              </div>
            </div>
          </div>
          {activeChart && (
            <PptxChartDataEditor
              chart={activeChart}
              onSeriesNameChange={updateChartSeriesName}
              onPointChange={updateChartSeriesPoint}
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
      </div>
    </div>
  );
}
function PptxAnimationInspector({
  animations,
  disabled,
  onTimingChange,
  onMove,
}: {
  animations: PptxAnimation[];
  disabled: boolean;
  onTimingChange: (
    animationId: string,
    patch: Pick<Partial<PptxAnimation>, "delayMs" | "durationMs">,
  ) => void;
  onMove: (animationId: string, direction: -1 | 1) => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Animations
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">
          {animations.length} timing nodes
        </span>
      </div>
      {animations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--text-faint)]">
          No slide animation timing
        </div>
      ) : (
        <div className="grid max-h-40 gap-1 overflow-auto">
          {animations.map((animation, index) => (
            <div
              key={`${animation.id}:${index}`}
              className="grid items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs md:grid-cols-[minmax(0,1fr)_5rem_5rem_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text)]">
                  {animationLabel(animation)}
                </div>
                <div className="truncate text-[11px] text-[var(--text-faint)]">
                  {[
                    animation.nodeType,
                    animation.presetClass,
                    animation.targetShapeId ? `target ${animation.targetShapeId}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <label className="grid gap-1 text-[11px] text-[var(--text-muted)]">
                <span>Delay</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  step={100}
                  value={animation.delayMs ?? 0}
                  onChange={(event) =>
                    onTimingChange(animation.id, {
                      delayMs: Math.max(0, Number(event.currentTarget.value) || 0),
                    })
                  }
                  disabled={disabled}
                  className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-[var(--text-muted)]">
                <span>Duration</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  step={100}
                  value={animation.durationMs ?? 0}
                  onChange={(event) =>
                    onTimingChange(animation.id, {
                      durationMs: Math.max(0, Number(event.currentTarget.value) || 0),
                    })
                  }
                  disabled={disabled}
                  className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
              </label>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => onMove(animation.id, -1)}
                  disabled={disabled || index === 0}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Move animation earlier"
                >
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(animation.id, 1)}
                  disabled={disabled || index >= animations.length - 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Move animation later"
                >
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PercentInput({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={Math.round(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-14 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function PptxShapeView({ shape }: { shape: PptxShape }) {
  const strokeWidth = Math.max(0, shape.strokeWidth ?? 2);
  const strokeColor = shape.strokeColor ?? "#111827";
  if (shape.kind === "line") {
    return (
      <div className="relative h-full w-full">
        <div
          className="absolute left-0 top-1/2 w-full -translate-y-1/2"
          style={{
            borderTop: `${Math.max(1, strokeWidth)}px solid ${strokeColor}`,
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="h-full w-full"
      style={{
        backgroundColor: shape.fillColor ?? "transparent",
        border: `${strokeWidth}px solid ${strokeColor}`,
        borderRadius: shape.kind === "ellipse" ? "9999px" : "4px",
      }}
    />
  );
}

function PptxImageView({ image }: { image: PptxImage }) {
  if (!image.dataUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 px-2 text-center text-[10px] text-neutral-500">
        {image.mediaPath ?? "Image"}
      </div>
    );
  }
  return (
    <img
      src={image.dataUrl}
      alt={image.altText ?? image.mediaPath ?? "Slide image"}
      draggable={false}
      className="h-full w-full object-contain"
    />
  );
}

function PptxChartDataEditor({
  chart,
  onSeriesNameChange,
  onPointChange,
}: {
  chart: PptxChart;
  onSeriesNameChange: (seriesIndex: number, value: string) => void;
  onPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
}) {
  const seriesList = chart.series ?? [];
  return (
    <div className="max-h-56 shrink-0 overflow-auto border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        <ChartColumn className="h-3.5 w-3.5" strokeWidth={1.75} />
        Chart data
      </div>
      {seriesList.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">
          No chart data
        </div>
      ) : (
        <div className="grid gap-2">
          {seriesList.map((series, seriesIndex) => {
            const rowCount = Math.max(
              series.categories?.length ?? 0,
              series.values?.length ?? 0,
              chart.categories?.length ?? 0,
            );
            return (
              <div
                key={`${series.name ?? "series"}-${seriesIndex}`}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2"
              >
                <label className="mb-2 grid gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Series
                  </span>
                  <input
                    value={series.name ?? ""}
                    onChange={(event) =>
                      onSeriesNameChange(seriesIndex, event.target.value)
                    }
                    className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                {rowCount > 0 ? (
                  <table className="w-full table-fixed border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-[var(--text-muted)]">
                        <th className="border border-[var(--border)] px-2 py-1 font-medium">
                          Category
                        </th>
                        <th className="border border-[var(--border)] px-2 py-1 font-medium">
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: rowCount }).map((_, pointIndex) => (
                        <tr key={pointIndex}>
                          <td className="border border-[var(--border)] p-0">
                            <input
                              value={
                                series.categories?.[pointIndex] ??
                                chart.categories?.[pointIndex] ??
                                ""
                              }
                              onChange={(event) =>
                                onPointChange(
                                  seriesIndex,
                                  pointIndex,
                                  "categories",
                                  event.target.value,
                                )
                              }
                              className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                            />
                          </td>
                          <td className="border border-[var(--border)] p-0">
                            <input
                              value={series.values?.[pointIndex] ?? ""}
                              onChange={(event) =>
                                onPointChange(
                                  seriesIndex,
                                  pointIndex,
                                  "values",
                                  event.target.value,
                                )
                              }
                              className="h-8 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="rounded border border-dashed border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
                    No chart data
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PptxChartView({ chart }: { chart: PptxChart }) {
  const values = (chart.series ?? [])
    .flatMap((series) => series.values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));

  return (
    <div className="flex h-full w-full flex-col border border-neutral-300 bg-white p-2 text-neutral-900 shadow-sm">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ChartColumn className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={1.75} />
          <div className="min-w-0 truncate text-xs font-semibold">
            {chart.title || chart.path || "Chart"}
          </div>
        </div>
        <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
          {chart.type ?? "chart"}
        </span>
      </div>
      {(chart.series ?? []).length > 0 ? (
        <div className="grid min-h-0 flex-1 gap-1 overflow-hidden">
          {(chart.series ?? []).slice(0, 4).map((series, seriesIndex) => (
            <div key={`${series.name ?? "series"}-${seriesIndex}`} className="min-h-0">
              <div className="truncate text-[10px] text-neutral-500">
                {series.name ?? `Series ${seriesIndex + 1}`}
              </div>
              <div className="mt-0.5 flex h-8 items-end gap-1">
                {(series.values ?? []).slice(0, 12).map((value, valueIndex) => {
                  const numberValue = Number(value);
                  const height = Number.isFinite(numberValue)
                    ? `${Math.max(8, (Math.abs(numberValue) / maxValue) * 100)}%`
                    : "8%";
                  return (
                    <div
                      key={`${value}-${valueIndex}`}
                      title={`${series.categories?.[valueIndex] ?? chart.categories?.[valueIndex] ?? ""} ${value}`}
                      className="min-w-1 flex-1 rounded-t-sm bg-emerald-500"
                      style={{ height }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center border border-dashed border-neutral-200 text-[10px] text-neutral-400">
          No chart data
        </div>
      )}
    </div>
  );
}

function PptxEditableTable({
  table,
  selected,
  zIndex,
  onSelect,
  onStartMove,
  onStartResize,
  onKeyDown,
  onCellChange,
}: {
  table: PptxTable;
  selected: boolean;
  zIndex: number;
  onSelect: () => void;
  onStartMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCellChange: (rowIndex: number, columnIndex: number, value: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute border border-neutral-400 bg-white text-neutral-950 shadow-sm outline-none",
        selected && "ring-2 ring-[var(--accent)]/40",
      )}
      style={pptxTableStyle(table, zIndex)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        onKeyDown(event);
      }}
    >
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td key={columnIndex} className="border border-neutral-300 p-0">
                  <textarea
                    value={cell}
                    onChange={(event) =>
                      onCellChange(rowIndex, columnIndex, event.target.value)
                    }
                    className="h-full min-h-8 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-4 outline-none focus:bg-blue-50"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <button
          type="button"
          onPointerDown={onStartMove}
          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
          title="Move table"
        >
          <Move className="h-3 w-3" strokeWidth={1.75} />
          Move
        </button>
      )}
      {selected && (
        <button
          type="button"
          onPointerDown={onStartResize}
          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
          title="Resize table"
        />
      )}
    </div>
  );
}

function PptxTableView({
  table,
  zIndex,
}: {
  table: PptxTable;
  zIndex: number;
}) {
  return (
    <div
      className="absolute overflow-hidden border border-neutral-400 bg-white text-neutral-950"
      style={pptxTableStyle(table, zIndex)}
    >
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className="whitespace-pre-wrap border border-neutral-300 px-1 py-0.5 align-top"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PptxReadOnlySlide({ slide }: { slide: PptxSlide }) {
  return (
    <div
      className="relative aspect-video w-full max-w-6xl overflow-hidden shadow-2xl"
      style={{ backgroundColor: slide.backgroundColor ?? "#ffffff" }}
    >
      {(slide.shapes ?? []).map((shape, index) => (
        <div
          key={shape.id}
          className="absolute"
          style={{
            left: `${shape.x ?? 24}%`,
            top: `${shape.y ?? 34}%`,
            width: `${shape.width ?? 26}%`,
            height: `${shape.kind === "line" ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
            transform: `rotate(${shape.rotation ?? 0}deg)`,
            zIndex: index + 1,
          }}
        >
          <PptxShapeView shape={shape} />
        </div>
      ))}
      {(slide.images ?? []).map((image, index) => (
        <div
          key={image.id}
          className="absolute"
          style={pptxImageStyle(image, (slide.shapes?.length ?? 0) + index + 1)}
        >
          <PptxImageView image={image} />
        </div>
      ))}
      {(slide.charts ?? []).map((chart, index) => (
        <div
          key={chart.id}
          className="absolute"
          style={pptxChartStyle(
            chart,
            (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              index +
              1,
          )}
        >
          <PptxChartView chart={chart} />
        </div>
      ))}
      {(slide.tables ?? []).map((table, index) => (
        <PptxTableView
          key={table.id}
          table={table}
          zIndex={
            (slide.shapes?.length ?? 0) +
            (slide.images?.length ?? 0) +
            (slide.charts?.length ?? 0) +
            index +
            1
          }
        />
      ))}
      {slide.texts.map((textItem, index) => (
        <div
          key={textItem.id}
          className="absolute whitespace-pre-wrap text-neutral-950"
          style={{
            left: `${textItem.x ?? 10}%`,
            top: `${textItem.y ?? 12 + index * 18}%`,
            width: `${textItem.width ?? 80}%`,
            height: `${textItem.height ?? 10}%`,
            transform: `rotate(${textItem.rotation ?? 0}deg)`,
            zIndex:
              (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              (slide.charts?.length ?? 0) +
              (slide.tables?.length ?? 0) +
              index +
              1,
            fontFamily: textItem.fontFamily ?? builtInFontFamilies[0],
            fontSize: `${textItem.fontSize ?? (index === 0 ? "28" : "18")}px`,
            fontWeight: textItem.bold ? 700 : index === 0 ? 600 : 400,
            fontStyle: textItem.italic ? "italic" : undefined,
            textDecorationLine: [
              textItem.underline ? "underline" : "",
              textItem.strikethrough ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" "),
            textAlign: textItem.align ?? "left",
            color: textItem.color,
            backgroundColor: textItem.fillColor,
          }}
        >
          {textItem.text}
        </div>
      ))}
    </div>
  );
}
