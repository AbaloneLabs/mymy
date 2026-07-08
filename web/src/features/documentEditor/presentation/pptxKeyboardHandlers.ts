import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  firstVisibleSlideIndex,
  lastVisibleSlideIndex,
} from "./pptxEditorUtils";
import type {
  PptxChart,
  PptxImage,
  PptxModel,
  PptxShape,
  PptxTable,
  PptxText,
} from "../shared/models";

type PptxObjectPatch = Partial<PptxText & PptxShape & PptxImage & PptxTable & PptxChart>;

type PptxKeyboardHandlerParams = {
  activeImage: PptxImage | undefined;
  activeObject:
    | {
        x?: number;
        y?: number;
      }
    | undefined;
  activeShape: PptxShape | undefined;
  activeTable: PptxTable | undefined;
  activeText: PptxText | undefined;
  clearObjectSelection: () => void;
  deleteSelectedObjects: () => void;
  duplicateSelectedObjects: () => void;
  groupSelectedObjects: () => void;
  hasMultiSelection: boolean;
  movePresentation: (delta: -1 | 1) => void;
  moveSelectedObjects: (deltaX: number, deltaY: number) => void;
  selectAllSlideObjects: () => void;
  setPresentingIndex: Dispatch<SetStateAction<number | null>>;
  slides: PptxModel["slides"];
  ungroupSelectedObjects: () => void;
  updateActiveChart: (patch: PptxObjectPatch) => void;
  updateActiveImage: (patch: PptxObjectPatch) => void;
  updateActiveShape: (patch: PptxObjectPatch) => void;
  updateActiveTable: (patch: PptxObjectPatch) => void;
  updateActiveText: (patch: PptxObjectPatch) => void;
};

export function createPptxKeyboardHandlers({
  activeImage,
  activeObject,
  activeShape,
  activeTable,
  activeText,
  clearObjectSelection,
  deleteSelectedObjects,
  duplicateSelectedObjects,
  groupSelectedObjects,
  hasMultiSelection,
  movePresentation,
  moveSelectedObjects,
  selectAllSlideObjects,
  setPresentingIndex,
  slides,
  ungroupSelectedObjects,
  updateActiveChart,
  updateActiveImage,
  updateActiveShape,
  updateActiveTable,
  updateActiveText,
}: PptxKeyboardHandlerParams) {
  function handlePresentationKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setPresentingIndex(null);
    } else if (event.key === "Home") {
      event.preventDefault();
      setPresentingIndex(firstVisibleSlideIndex(slides));
    } else if (event.key === "End") {
      event.preventDefault();
      setPresentingIndex(lastVisibleSlideIndex(slides));
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

  return {
    handleCanvasKeyDown,
    handlePresentationKeyDown,
    handleTextKeyDown,
  };
}
