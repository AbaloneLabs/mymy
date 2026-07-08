import type { RefObject } from "react";
import type {
  PptxChart,
  PptxImage,
  PptxModel,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "../shared/models";
import type { PptxObject } from "./pptxSelection";

export interface PptxEditorToolbarProps {
  model: PptxModel;
  slide: PptxSlide | undefined;
  activeText: PptxText | undefined;
  activeShape: PptxShape | undefined;
  activeImage: PptxImage | undefined;
  activeTable: PptxTable | undefined;
  activeChart: PptxChart | undefined;
  activeObject: PptxObject | undefined;
  activeLayerIndex: number;
  activeLayerLength: number;
  hasObjectSelection: boolean;
  hasMultiSelection: boolean;
  selectedObjectCount: number;
  canUngroupSelection: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onAddSlide: () => void;
  onDuplicateSlide: () => void;
  onMoveSlide: (direction: -1 | 1) => void;
  onDeleteSlide: () => void;
  onToggleSlideHidden: () => void;
  onPresentBeginning: () => void;
  onPresentCurrent: () => void;
  onAddTextBox: () => void;
  onAddShape: (kind: PptxShape["kind"]) => void;
  onAddImageFile: (file: File) => void;
  onSetSlideBackgroundImage: (file: File) => void;
  onAddTable: () => void;
  onDuplicateSelectedObjects: () => void;
  onDeleteSelectedObjects: () => void;
  onGroupSelectedObjects: () => void;
  onUngroupSelectedObjects: () => void;
  onMoveActiveObjectLayer: (direction: -1 | 1) => void;
  onAlignActiveObject: (
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => void;
  onDistributeSelectedObjects: (axis: "horizontal" | "vertical") => void;
  onUpdateModel: (patch: Partial<PptxModel>) => void;
  onUpdateSlide: (patch: Partial<PptxSlide>) => void;
  onUpdateActiveText: (patch: Partial<PptxText>) => void;
  onUpdateActiveShape: (patch: Partial<PptxShape>) => void;
  onUpdateActiveImage: (patch: Partial<PptxImage>) => void;
  onUpdateActiveTable: (patch: Partial<PptxTable>) => void;
  onUpdateActiveChart: (patch: Partial<PptxChart>) => void;
}
