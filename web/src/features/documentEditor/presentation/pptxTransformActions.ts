import type { Dispatch, SetStateAction } from "react";
import { clampPercent, nextPptxGroupId } from "./pptxEditorUtils";
import { duplicatePptxSelectedObjects } from "./pptxObjectDuplication";
import {
  pptxGroupingBlockReason,
  pptxObjectDuplicationBlockReason,
} from "./pptxReferenceGraph";
import {
  patchPptxSlideObjects,
  pptxSelectionBounds,
  pptxSelectionKey,
  pptxSlideObjectRecords,
} from "./pptxSelection";
import type { PptxGeometryPatch, PptxSelectionKey } from "./pptxSelection";
import type { PptxModel, PptxSlide } from "../shared/models";

type PptxTransformActionParams = {
  activateObjectKey: (key: PptxSelectionKey | null) => void;
  activeObject:
    | {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }
    | undefined;
  deleteActiveObject: () => void;
  deleteObjectKeys: (keys: Set<PptxSelectionKey>) => void;
  duplicateActiveObject: () => void;
  model: PptxModel;
  onChange: (model: PptxModel) => void;
  selectedObjectKeys: PptxSelectionKey[];
  selectedObjects: ReturnType<typeof pptxSlideObjectRecords>;
  setSelectedObjectKeys: Dispatch<SetStateAction<PptxSelectionKey[]>>;
  slide: PptxSlide | undefined;
  updateActiveObjectGeometry: (patch: PptxGeometryPatch) => void;
};

export function createPptxTransformActions({
  activateObjectKey,
  activeObject,
  deleteActiveObject,
  deleteObjectKeys,
  duplicateActiveObject,
  model,
  onChange,
  selectedObjectKeys,
  selectedObjects,
  setSelectedObjectKeys,
  slide,
  updateActiveObjectGeometry,
}: PptxTransformActionParams) {
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
    const blockReason = pptxObjectDuplicationBlockReason(slide, selectedObjects);
    if (blockReason) {
      window.alert(blockReason);
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
    const blockReason = pptxGroupingBlockReason(slide);
    if (blockReason) {
      window.alert(blockReason);
      return;
    }
    const groupId = nextPptxGroupId(slide);
    const patches = new Map<PptxSelectionKey, PptxGeometryPatch>();
    selectedObjects.forEach((record) => {
      patches.set(pptxSelectionKey(record.objectKind, record.objectId), {
        groupId,
        groupShapeId: undefined,
      });
    });
    updateObjectGeometries(patches);
  }

  function ungroupSelectedObjects() {
    if (!slide || selectedObjects.length === 0) return;
    const blockReason = pptxGroupingBlockReason(slide);
    if (blockReason) {
      window.alert(blockReason);
      return;
    }
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
        groupShapeId: undefined,
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

  return {
    alignActiveObject,
    deleteSelectedObjects,
    distributeSelectedObjects,
    duplicateSelectedObjects,
    groupSelectedObjects,
    moveSelectedObjects,
    ungroupSelectedObjects,
    updateObjectGeometries,
  };
}
