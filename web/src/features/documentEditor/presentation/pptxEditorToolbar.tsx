import { PptxActiveObjectToolbarControls } from "./pptxActiveObjectToolbarControls";
import { normalizeRotation } from "./pptxEditorUtils";
import type { PptxGeometryPatch } from "./pptxSelection";
import { PptxSelectionToolbarControls } from "./pptxSelectionToolbarControls";
import { PptxSlideBackgroundControls } from "./pptxSlideBackgroundControls";
import { PptxSlideToolbarControls } from "./pptxSlideToolbarControls";
import { PptxTextShapeToolbarControls } from "./pptxTextShapeToolbarControls";
import type { PptxEditorToolbarProps } from "./pptxEditorToolbarTypes";

export function PptxEditorToolbar({
  model,
  slide,
  activeText,
  activeShape,
  activeImage,
  activeTable,
  activeChart,
  activeObject,
  activeLayerIndex,
  activeLayerLength,
  hasObjectSelection,
  hasMultiSelection,
  selectedObjectCount,
  canUngroupSelection,
  imageInputRef,
  onAddSlide,
  onDuplicateSlide,
  onMoveSlide,
  onDeleteSlide,
  onToggleSlideHidden,
  onPresentBeginning,
  onPresentCurrent,
  onAddTextBox,
  onAddShape,
  onAddImageFile,
  onSetSlideBackgroundImage,
  onAddTable,
  onDuplicateSelectedObjects,
  onDeleteSelectedObjects,
  onGroupSelectedObjects,
  onUngroupSelectedObjects,
  onMoveActiveObjectLayer,
  onAlignActiveObject,
  onDistributeSelectedObjects,
  onUpdateModel,
  onUpdateSlide,
  onUpdateActiveText,
  onUpdateActiveShape,
  onUpdateActiveImage,
  onUpdateActiveTable,
  onUpdateActiveChart,
}: PptxEditorToolbarProps) {
  function rotateActiveObject() {
    if (activeText) {
      onUpdateActiveText({
        rotation: normalizeRotation((activeText.rotation ?? 0) + 15),
      });
    } else if (activeShape) {
      onUpdateActiveShape({
        rotation: normalizeRotation((activeShape.rotation ?? 0) + 15),
      });
    } else if (activeImage) {
      onUpdateActiveImage({
        rotation: normalizeRotation((activeImage.rotation ?? 0) + 15),
      });
    } else if (activeTable) {
      onUpdateActiveTable({
        rotation: normalizeRotation((activeTable.rotation ?? 0) + 15),
      });
    } else {
      onUpdateActiveChart({
        rotation: normalizeRotation((activeChart?.rotation ?? 0) + 15),
      });
    }
  }

  function updateActiveObjectGeometry(patch: PptxGeometryPatch) {
    if (activeText) {
      onUpdateActiveText(patch);
    } else if (activeShape) {
      onUpdateActiveShape(patch);
    } else if (activeImage) {
      onUpdateActiveImage(patch);
    } else if (activeTable) {
      onUpdateActiveTable(patch);
    } else {
      onUpdateActiveChart(patch);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
      <PptxSlideToolbarControls
        model={model}
        slide={slide}
        imageInputRef={imageInputRef}
        onAddSlide={onAddSlide}
        onDuplicateSlide={onDuplicateSlide}
        onMoveSlide={onMoveSlide}
        onDeleteSlide={onDeleteSlide}
        onToggleSlideHidden={onToggleSlideHidden}
        onPresentBeginning={onPresentBeginning}
        onPresentCurrent={onPresentCurrent}
        onAddTextBox={onAddTextBox}
        onAddShape={onAddShape}
        onAddImageFile={onAddImageFile}
        onAddTable={onAddTable}
        onUpdateModel={onUpdateModel}
      />
      <PptxSelectionToolbarControls
        activeLayerIndex={activeLayerIndex}
        activeLayerLength={activeLayerLength}
        activeObject={activeObject}
        canUngroupSelection={canUngroupSelection}
        hasMultiSelection={hasMultiSelection}
        hasObjectSelection={hasObjectSelection}
        onAlignActiveObject={onAlignActiveObject}
        onDeleteSelectedObjects={onDeleteSelectedObjects}
        onDistributeSelectedObjects={onDistributeSelectedObjects}
        onDuplicateSelectedObjects={onDuplicateSelectedObjects}
        onGroupSelectedObjects={onGroupSelectedObjects}
        onMoveActiveObjectLayer={onMoveActiveObjectLayer}
        onUngroupSelectedObjects={onUngroupSelectedObjects}
        selectedObjectCount={selectedObjectCount}
        slide={slide}
      />
      <PptxTextShapeToolbarControls
        activeObject={activeObject}
        activeShape={activeShape}
        activeText={activeText}
        hasMultiSelection={hasMultiSelection}
        onRotateActiveObject={rotateActiveObject}
        onUpdateActiveShape={onUpdateActiveShape}
        onUpdateActiveText={onUpdateActiveText}
      />
      <PptxSlideBackgroundControls
        onSetSlideBackgroundImage={onSetSlideBackgroundImage}
        onUpdateSlide={onUpdateSlide}
        slide={slide}
      />
      <PptxActiveObjectToolbarControls
        model={model}
        activeObject={activeObject}
        activeImage={activeImage}
        activeTable={activeTable}
        activeChart={activeChart}
        hasMultiSelection={hasMultiSelection}
        selectedObjectCount={selectedObjectCount}
        onUpdateActiveObjectGeometry={updateActiveObjectGeometry}
        onUpdateActiveImage={onUpdateActiveImage}
        onUpdateActiveTable={onUpdateActiveTable}
        onUpdateActiveChart={onUpdateActiveChart}
      />
    </div>
  );
}

export type { PptxEditorToolbarProps } from "./pptxEditorToolbarTypes";
