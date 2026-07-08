import type { Dispatch, SetStateAction } from "react";
import {
  parsePptxSelectionKey,
  pptxSelectionKey,
  pptxSlideObjectRecords,
} from "./pptxSelection";
import type { PptxObjectKind, PptxSelectionKey } from "./pptxSelection";
import type { PptxSlide } from "../shared/models";

type PptxSelectionActionParams = {
  selectedObjectKeys: PptxSelectionKey[];
  setActiveChartId: Dispatch<SetStateAction<string | null>>;
  setActiveImageId: Dispatch<SetStateAction<string | null>>;
  setActiveShapeId: Dispatch<SetStateAction<string | null>>;
  setActiveTableId: Dispatch<SetStateAction<string | null>>;
  setActiveTextId: Dispatch<SetStateAction<string | null>>;
  setSelectedObjectKeys: Dispatch<SetStateAction<PptxSelectionKey[]>>;
  slide: PptxSlide | undefined;
};

/**
 * Selection actions are isolated because grouped PowerPoint objects can map one
 * click to several object keys, while the editor still keeps a single active key.
 */
export function createPptxSelectionActions({
  selectedObjectKeys,
  setActiveChartId,
  setActiveImageId,
  setActiveShapeId,
  setActiveTableId,
  setActiveTextId,
  setSelectedObjectKeys,
  slide,
}: PptxSelectionActionParams) {
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

  return {
    activateObjectKey,
    clearObjectSelection,
    expandGroupedSelectionKeys,
    selectAllSlideObjects,
    selectChart,
    selectImage,
    selectObject,
    selectShape,
    selectTable,
    selectText,
    selectionKeysForObject,
  };
}
