import type { RefObject } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  EyeOff,
  Group,
  Image as ImageIcon,
  Italic,
  Minus,
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
  Ungroup,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  PptxChart,
  PptxImage,
  PptxModel,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";
import { normalizeRotation } from "./pptxEditorUtils";
import type { PptxGeometryPatch, PptxObject } from "./pptxSelection";
import { FontFamilySelect, ToolbarButton } from "./shared";
import { PercentInput } from "./pptxEditorPanels";

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
  onAddTable,
  onDuplicateSelectedObjects,
  onDeleteSelectedObjects,
  onGroupSelectedObjects,
  onUngroupSelectedObjects,
  onMoveActiveObjectLayer,
  onAlignActiveObject,
  onDistributeSelectedObjects,
  onUpdateSlide,
  onUpdateActiveText,
  onUpdateActiveShape,
  onUpdateActiveImage,
  onUpdateActiveTable,
  onUpdateActiveChart,
}: {
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
  onUpdateSlide: (patch: Partial<PptxSlide>) => void;
  onUpdateActiveText: (patch: Partial<PptxText>) => void;
  onUpdateActiveShape: (patch: Partial<PptxShape>) => void;
  onUpdateActiveImage: (patch: Partial<PptxImage>) => void;
  onUpdateActiveTable: (patch: Partial<PptxTable>) => void;
  onUpdateActiveChart: (patch: Partial<PptxChart>) => void;
}) {
  const { t } = useTranslation();

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
      <button
        type="button"
        onClick={onAddSlide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        New slide
      </button>
      <button
        type="button"
        onClick={onDuplicateSlide}
        disabled={!slide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        Duplicate slide
      </button>
      <button
        type="button"
        onClick={() => onMoveSlide(-1)}
        disabled={!slide || model.slides[0]?.id === slide.id}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Move slide up"
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveSlide(1)}
        disabled={!slide || model.slides.at(-1)?.id === slide.id}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Move slide down"
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteSlide}
        disabled={!slide || model.slides.length <= 1}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete slide"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onToggleSlideHidden}
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
        onClick={onPresentBeginning}
        disabled={model.slides.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Present from beginning"
      >
        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
        Present
      </button>
      <button
        type="button"
        onClick={onPresentCurrent}
        disabled={!slide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Present current slide"
      >
        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
        Current
      </button>
      <button
        type="button"
        onClick={onAddTextBox}
        disabled={!slide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        <Type className="h-3.5 w-3.5" strokeWidth={1.75} />
        Text box
      </button>
      <button
        type="button"
        onClick={() => onAddShape("rect")}
        disabled={!slide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
        Rectangle
      </button>
      <button
        type="button"
        onClick={() => onAddShape("ellipse")}
        disabled={!slide}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        <Circle className="h-3.5 w-3.5" strokeWidth={1.75} />
        Ellipse
      </button>
      <button
        type="button"
        onClick={() => onAddShape("line")}
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
        onClick={onAddTable}
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
          if (file) onAddImageFile(file);
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        onClick={onDuplicateSelectedObjects}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Duplicate selected object"
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteSelectedObjects}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete selected object"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onGroupSelectedObjects}
        disabled={selectedObjectCount < 2}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.commands.group", { defaultValue: "Group" })}
      >
        <Group className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onUngroupSelectedObjects}
        disabled={!canUngroupSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.commands.ungroup", { defaultValue: "Ungroup" })}
      >
        <Ungroup className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveActiveObjectLayer(-1)}
        disabled={!activeObject || hasMultiSelection || activeLayerIndex <= 0}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Send backward"
      >
        <SendToBack className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveActiveObjectLayer(1)}
        disabled={
          !activeObject ||
          hasMultiSelection ||
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
        onClick={() => onAlignActiveObject("left")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to left edge"
      >
        <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("center")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to horizontal center"
      >
        <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("right")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to right edge"
      >
        <AlignRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("top")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to top edge"
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("middle")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to vertical middle"
      >
        <AlignCenter className="h-3.5 w-3.5 rotate-90" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("bottom")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to bottom edge"
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onDistributeSelectedObjects("horizontal")}
        disabled={selectedObjectCount <= 2}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Distribute horizontally"
      >
        Dist H
      </button>
      <button
        type="button"
        onClick={() => onDistributeSelectedObjects("vertical")}
        disabled={selectedObjectCount <= 2}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Distribute vertically"
      >
        Dist V
      </button>
      <FontFamilySelect
        value={activeText?.fontFamily}
        onChange={(fontFamily) => onUpdateActiveText({ fontFamily })}
        compact
      />
      <select
        value={activeText?.fontSize ?? "18"}
        onChange={(event) => onUpdateActiveText({ fontSize: event.target.value })}
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
        onClick={() => onUpdateActiveText({ bold: !activeText?.bold })}
        active={activeText?.bold}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={Italic}
        label={t("documentEditor.italic")}
        onClick={() => onUpdateActiveText({ italic: !activeText?.italic })}
        active={activeText?.italic}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={Underline}
        label={t("documentEditor.underline", { defaultValue: "Underline" })}
        onClick={() => onUpdateActiveText({ underline: !activeText?.underline })}
        active={activeText?.underline}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={Strikethrough}
        label="Strikethrough"
        onClick={() =>
          onUpdateActiveText({ strikethrough: !activeText?.strikethrough })
        }
        active={activeText?.strikethrough}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={AlignLeft}
        label="Left"
        onClick={() => onUpdateActiveText({ align: "left" })}
        active={!activeText?.align || activeText.align === "left"}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={AlignCenter}
        label="Center"
        onClick={() => onUpdateActiveText({ align: "center" })}
        active={activeText?.align === "center"}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={AlignRight}
        label="Right"
        onClick={() => onUpdateActiveText({ align: "right" })}
        active={activeText?.align === "right"}
        disabled={!activeText}
      />
      <ToolbarButton
        icon={RotateCw}
        label="Rotate"
        onClick={rotateActiveObject}
        disabled={!activeObject || hasMultiSelection}
      />
      <label
        className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
        title="Text color"
      >
        Text
        <input
          type="color"
          value={activeText?.color ?? "#111827"}
          onChange={(event) => onUpdateActiveText({ color: event.target.value })}
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
              ? onUpdateActiveText({ fillColor: event.target.value })
              : onUpdateActiveShape({ fillColor: event.target.value })
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
                onUpdateActiveShape({ strokeColor: event.target.value })
              }
              className="h-5 w-6 cursor-pointer bg-transparent"
            />
          </label>
          <PercentInput
            label="SW"
            value={activeShape.strokeWidth ?? 2}
            min={0}
            max={12}
            onChange={(strokeWidth) => onUpdateActiveShape({ strokeWidth })}
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
          onChange={(event) => onUpdateSlide({ backgroundColor: event.target.value })}
          disabled={!slide}
          className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
        />
      </label>
      {hasMultiSelection && (
        <div className="ml-auto rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
          {selectedObjectCount} selected
        </div>
      )}
      {activeObject && !hasMultiSelection && (
        <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          {activeImage && (
            <input
              value={activeImage.altText ?? ""}
              onChange={(event) =>
                onUpdateActiveImage({ altText: event.target.value })
              }
              placeholder="Alt text"
              className="h-8 w-36 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          )}
          {activeChart && (
            <input
              value={activeChart.title ?? ""}
              onChange={(event) =>
                onUpdateActiveChart({ title: event.target.value })
              }
              placeholder="Chart title"
              className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          )}
          <PercentInput
            label="X"
            value={activeObject.x ?? 10}
            onChange={(x) => updateActiveObjectGeometry({ x })}
          />
          <PercentInput
            label="Y"
            value={activeObject.y ?? 12}
            onChange={(y) => updateActiveObjectGeometry({ y })}
          />
          <PercentInput
            label="W"
            value={activeObject.width ?? 80}
            onChange={(width) => updateActiveObjectGeometry({ width })}
          />
          <PercentInput
            label="H"
            value={activeObject.height ?? 10}
            onChange={(height) => updateActiveObjectGeometry({ height })}
          />
          <PercentInput
            label="R"
            value={activeObject.rotation ?? 0}
            min={0}
            max={359}
            onChange={(rotation) => updateActiveObjectGeometry({ rotation })}
          />
        </div>
      )}
    </div>
  );
}
