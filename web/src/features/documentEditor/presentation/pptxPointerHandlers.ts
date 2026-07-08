import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  clampPercent,
  lockedAspectResize,
} from "./pptxEditorUtils";
import type { PptxSnapGuide, SlideDragState } from "./pptxEditorUtils";
import {
  pptxBoundsFromItems,
  pptxMoveSnap,
  pptxObjectContainsPoint,
  pptxResizeSnap,
  pptxSnapTargets,
} from "./pptxEditorGeometry";
import {
  pptxObjectIntersectsSelectionBox,
  pptxSelectionBoxBounds,
  pptxSelectionKey,
  pptxSlideObjectRecords,
} from "./pptxSelection";
import type {
  PptxGeometryPatch,
  PptxObjectKind,
  PptxSelectionBox,
  PptxSelectionKey,
} from "./pptxSelection";
import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";

interface PptxPointerHandlerParams {
  activateObjectKey: (key: PptxSelectionKey | null) => void;
  activeObjectKey: PptxSelectionKey | null;
  canvasRef: RefObject<HTMLDivElement | null>;
  clearObjectSelection: () => void;
  dragState: SlideDragState | null;
  expandGroupedSelectionKeys: (keys: PptxSelectionKey[]) => PptxSelectionKey[];
  selectChart: (chartId: string | null, additive?: boolean) => void;
  selectImage: (imageId: string | null, additive?: boolean) => void;
  selectObject: (
    objectKind: PptxObjectKind,
    objectId: string,
    additive?: boolean,
  ) => void;
  selectShape: (shapeId: string | null, additive?: boolean) => void;
  selectTable: (tableId: string | null, additive?: boolean) => void;
  selectText: (textId: string | null, additive?: boolean) => void;
  selectedObjectKeys: PptxSelectionKey[];
  selectedObjectKeySet: Set<PptxSelectionKey>;
  selectionBox: PptxSelectionBox | null;
  selectionKeysForObject: (
    objectKind: PptxObjectKind,
    objectId: string,
  ) => PptxSelectionKey[];
  setDragState: Dispatch<SetStateAction<SlideDragState | null>>;
  setSelectedObjectKeys: Dispatch<SetStateAction<PptxSelectionKey[]>>;
  setSelectionBox: Dispatch<SetStateAction<PptxSelectionBox | null>>;
  setSnapGuides: Dispatch<SetStateAction<PptxSnapGuide[]>>;
  slide: PptxSlide | undefined;
  updateChartById: (chartId: string, patch: Partial<PptxChart>) => void;
  updateImageById: (imageId: string, patch: Partial<PptxImage>) => void;
  updateObjectGeometries: (
    patches: Map<PptxSelectionKey, PptxGeometryPatch>,
  ) => void;
  updateShapeById: (shapeId: string, patch: Partial<PptxShape>) => void;
  updateTableById: (tableId: string, patch: Partial<PptxTable>) => void;
  updateTextById: (textId: string, patch: Partial<PptxText>) => void;
}

export function usePptxPointerHandlers({
  activateObjectKey,
  activeObjectKey,
  canvasRef,
  clearObjectSelection,
  dragState,
  expandGroupedSelectionKeys,
  selectChart,
  selectImage,
  selectObject,
  selectShape,
  selectTable,
  selectText,
  selectedObjectKeys,
  selectedObjectKeySet,
  selectionBox,
  selectionKeysForObject,
  setDragState,
  setSelectedObjectKeys,
  setSelectionBox,
  setSnapGuides,
  slide,
  updateChartById,
  updateImageById,
  updateObjectGeometries,
  updateShapeById,
  updateTableById,
  updateTextById,
}: PptxPointerHandlerParams) {
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
    activateDraggedObject(objectKind, object.id, clickedKey);
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

  function activateDraggedObject(
    objectKind: PptxObjectKind,
    objectId: string,
    clickedKey: PptxSelectionKey,
  ) {
    if (selectedObjectKeySet.has(clickedKey)) {
      activateObjectKey(clickedKey);
      return;
    }
    if (objectKind === "text") {
      selectText(objectId);
    } else if (objectKind === "shape") {
      selectShape(objectId);
    } else if (objectKind === "image") {
      selectImage(objectId);
    } else if (objectKind === "table") {
      selectTable(objectId);
    } else {
      selectChart(objectId);
    }
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

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
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
    const updateObject = updateObjectByDragKind(dragState.objectKind);
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

  function updateObjectByDragKind(objectKind: SlideDragState["objectKind"]) {
    if (objectKind === "text") return updateTextById;
    if (objectKind === "shape") return updateShapeById;
    if (objectKind === "image") return updateImageById;
    if (objectKind === "table") return updateTableById;
    return updateChartById;
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

  return {
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    startObjectDrag,
  };
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
