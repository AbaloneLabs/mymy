import type { Dispatch, SetStateAction } from "react";
import { builtInFontFamilies } from "../shared/fonts";
import {
  isPptxLineShapeKind,
  nextPptxImageId,
  nextPptxShapeId,
  nextPptxTableId,
  nextPptxTextId,
  reorderPptxObjectsById,
} from "./pptxEditorUtils";
import { duplicatePptxSelectedObjects } from "./pptxObjectDuplication";
import {
  parsePptxSelectionKey,
  pptxSelectionKey,
  pptxSlideObjectRecords,
} from "./pptxSelection";
import type { PptxSelectionKey } from "./pptxSelection";
import { createPptxTableEditors } from "./pptxTableEditors";
import type {
  PptxChart,
  PptxImage,
  PptxMedia,
  PptxModel,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";

type PptxObjectActionParams = {
  activateObjectKey: (key: PptxSelectionKey | null) => void;
  activeChart: PptxChart | undefined;
  activeImage: PptxImage | undefined;
  activeObjectKey: PptxSelectionKey | null;
  activeShape: PptxShape | undefined;
  activeTable: PptxTable | undefined;
  activeText: PptxText | undefined;
  clearObjectSelection: () => void;
  model: PptxModel;
  onChange: (model: PptxModel) => void;
  selectImage: (imageId: string | null, additive?: boolean) => void;
  selectShape: (shapeId: string | null, additive?: boolean) => void;
  selectTable: (tableId: string | null, additive?: boolean) => void;
  selectText: (textId: string | null, additive?: boolean) => void;
  setSelectedObjectKeys: Dispatch<SetStateAction<PptxSelectionKey[]>>;
  slide: PptxSlide | undefined;
  slideAspectRatio: number;
  updateSlide: (patch: Partial<PptxSlide>) => void;
};

export function createPptxObjectActions({
  activateObjectKey,
  activeChart,
  activeImage,
  activeObjectKey,
  activeShape,
  activeTable,
  activeText,
  clearObjectSelection,
  model,
  onChange,
  selectImage,
  selectShape,
  selectTable,
  selectText,
  setSelectedObjectKeys,
  slide,
  slideAspectRatio,
  updateSlide,
}: PptxObjectActionParams) {
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
        const height = Math.min(70, Math.max(10, (width * slideAspectRatio) / aspect));
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

  return {
    addImageFile,
    addShape,
    addTable,
    addTableColumn,
    addTableRow,
    addTextBox,
    deleteActiveObject,
    deleteObjectKeys,
    deleteTableColumn,
    deleteTableRow,
    duplicateActiveObject,
    moveActiveObjectLayer,
    moveObjectLayer,
    setSlideBackgroundImage,
    updateActiveChart,
    updateActiveImage,
    updateActiveObjectGeometry,
    updateActiveShape,
    updateActiveTable,
    updateActiveText,
    updateChartById,
    updateImageById,
    updateMediaById,
    updateShapeById,
    updateTableById,
    updateTableCell,
    updateTableCellStyle,
    updateTableColumnWidth,
    updateTableRowHeight,
    updateText,
    updateTextById,
  };
}
