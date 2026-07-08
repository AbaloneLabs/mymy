import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditorCommandRequest } from "../shared/commands";
import {
  adjacentVisibleSlideIndex,
  firstVisibleSlideIndex,
  nextVisibleSlideIndex,
  pptxSlideAspectRatio,
} from "../presentation/pptxEditorUtils";
import type { PptxSnapGuide, SlideDragState } from "../presentation/pptxEditorUtils";
import { pptxSelectionKey } from "../presentation/pptxSelection";
import type {
  PptxSelectionBox,
  PptxSelectionKey,
} from "../presentation/pptxSelection";
import type { PptxModel } from "../shared/models";
import { runPptxEditorCommand } from "../presentation/pptxEditorCommands";
import {
  PptxObjectLayerPanel,
  PptxPresentationOverlay,
  PptxSlideNavigator,
} from "../presentation/pptxPresentationPanels";
import { PptxEditorToolbar } from "../presentation/pptxEditorToolbar";
import { PptxSlideCanvas } from "../presentation/pptxSlideCanvas";
import { PptxSlidePropertiesPanel } from "../presentation/pptxSlidePropertiesPanel";
import { derivePptxEditorState } from "../presentation/pptxEditorState";
import { createPptxSelectionActions } from "../presentation/pptxEditorSelectionActions";
import { createPptxChartSeriesActions } from "../presentation/pptxChartSeriesActions";
import { createPptxSlideActions } from "../presentation/pptxSlideActions";
import { createPptxObjectActions } from "../presentation/pptxObjectActions";
import { createPptxTransformActions } from "../presentation/pptxTransformActions";
import { createPptxKeyboardHandlers } from "../presentation/pptxKeyboardHandlers";
import { usePptxPointerHandlers } from "../presentation/pptxPointerHandlers";

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
  const slideAspectRatio = pptxSlideAspectRatio(model);

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

  const {
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
  } = createPptxSelectionActions({
    selectedObjectKeys,
    setActiveChartId,
    setActiveImageId,
    setActiveShapeId,
    setActiveTableId,
    setActiveTextId,
    setSelectedObjectKeys,
    slide,
  });
  const {
    addAnimation,
    addSlide,
    deleteAnimation,
    deleteSlide,
    duplicateSlide,
    moveAnimation,
    moveSlide,
    resetSlideLayout,
    toggleSlideHidden,
    updateAnimationTiming,
    updateMaster,
    updateMasterPlaceholder,
    updatePresentation,
    updateSlide,
    updateSlideLayout,
    updateSlideNotes,
    updateSlideTransition,
    updateTheme,
    updateThemeColor,
  } = createPptxSlideActions({
    clearObjectSelection,
    model,
    onChange,
    selectText,
    setPreferredSlideId,
    slide,
  });
  const {
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
  } = createPptxObjectActions({
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
  });

  const {
    addChartPoint,
    addChartSeries,
    deleteChartPoint,
    deleteChartSeries,
    updateChartSeriesName,
    updateChartSeriesPoint,
  } = createPptxChartSeriesActions({
    activeChart,
    updateActiveChart,
  });
  const {
    alignActiveObject,
    deleteSelectedObjects,
    distributeSelectedObjects,
    duplicateSelectedObjects,
    groupSelectedObjects,
    moveSelectedObjects,
    ungroupSelectedObjects,
    updateObjectGeometries,
  } = createPptxTransformActions({
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
  });

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

  const {
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    startObjectDrag,
  } = usePptxPointerHandlers({
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
  });

  function movePresentation(delta: -1 | 1) {
    setPresentingIndex((current) => {
      if (current === null) return current;
      return adjacentVisibleSlideIndex(model.slides, current, delta) ?? current;
    });
  }
  const {
    handleCanvasKeyDown,
    handlePresentationKeyDown,
    handleTextKeyDown,
  } = createPptxKeyboardHandlers({
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
    slides: model.slides,
    ungroupSelectedObjects,
    updateActiveChart,
    updateActiveImage,
    updateActiveShape,
    updateActiveTable,
    updateActiveText,
  });

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
        onUpdateModel={updatePresentation}
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
          slideAspectRatio={slideAspectRatio}
          onMove={movePresentation}
          onClose={() => setPresentingIndex(null)}
          onKeyDown={handlePresentationKeyDown}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <PptxSlideNavigator
          slides={model.slides}
          activeSlideId={slide?.id}
          slideAspectRatio={slideAspectRatio}
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
            slideAspectRatio={slideAspectRatio}
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
          <PptxSlidePropertiesPanel
            model={model}
            slide={slide}
            activeChart={activeChart}
            activeTheme={activeTheme}
            onChartChange={updateActiveChart}
            onChartSeriesNameChange={updateChartSeriesName}
            onChartPointChange={updateChartSeriesPoint}
            onAddChartSeries={addChartSeries}
            onDeleteChartSeries={deleteChartSeries}
            onAddChartPoint={addChartPoint}
            onDeleteChartPoint={deleteChartPoint}
            onSlideLayoutChange={updateSlideLayout}
            onResetSlideLayout={resetSlideLayout}
            onSlideTransitionChange={updateSlideTransition}
            onThemeChange={(patch) => {
              if (!activeTheme) return;
              updateTheme(activeTheme.path, patch);
            }}
            onThemeColorChange={(key, color) => {
              if (!activeTheme) return;
              updateThemeColor(activeTheme.path, key, color);
            }}
            onMasterChange={updateMaster}
            onMasterPlaceholderChange={updateMasterPlaceholder}
            onAnimationTimingChange={updateAnimationTiming}
            onAddAnimation={addAnimation}
            onDeleteAnimation={deleteAnimation}
            onMoveAnimation={moveAnimation}
            onMediaChange={updateMediaById}
            onSlideNotesChange={updateSlideNotes}
          />
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
