import type { RefObject } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Bold,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Circle,
  Cloud,
  Copy,
  Diamond,
  EyeOff,
  Group,
  Heart,
  Hexagon,
  Image as ImageIcon,
  Italic,
  Minus,
  Pentagon,
  Play,
  Plus,
  RotateCw,
  SendToBack,
  Square,
  SquareRoundCorner,
  Star,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Triangle,
  Type,
  Underline,
  Ungroup,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  PptxChart,
  PptxImage,
  PptxLineArrow,
  PptxModel,
  PptxShape,
  PptxSlide,
  PptxTable,
  PptxText,
} from "./models";
import { isPptxLineShape, normalizeRotation } from "./pptxEditorUtils";
import type { PptxGeometryPatch, PptxObject } from "./pptxSelection";
import { FontFamilySelect, ToolbarButton } from "./shared";
import { PercentInput } from "./pptxPercentInput";

type PptxImageCropKey = keyof Pick<
  PptxImage,
  "imageCropLeft" | "imageCropTop" | "imageCropRight" | "imageCropBottom"
>;

const PPTX_IMAGE_CROP_CONTROLS: Array<{
  key: PptxImageCropKey;
  label: string;
}> = [
  { key: "imageCropLeft", label: "CL" },
  { key: "imageCropTop", label: "CT" },
  { key: "imageCropRight", label: "CR" },
  { key: "imageCropBottom", label: "CB" },
];

const PPTX_LINE_ARROW_OPTIONS: Array<{ value: PptxLineArrow; label: string }> = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Triangle" },
  { value: "stealth", label: "Stealth" },
  { value: "diamond", label: "Diamond" },
  { value: "oval", label: "Oval" },
];

const PPTX_CHART_TYPE_OPTIONS = ["bar", "line", "area", "pie", "doughnut"] as const;
const PPTX_DEFAULT_TABLE_STYLE_ID = "{5940675A-B579-460E-94D1-54222C63F5DA}";

const PPTX_SHAPE_GALLERY: Array<{
  kind: PptxShape["kind"];
  label: string;
  icon: typeof Square;
}> = [
  { kind: "rect", label: "Rectangle", icon: Square },
  { kind: "roundRect", label: "Rounded rectangle", icon: SquareRoundCorner },
  { kind: "ellipse", label: "Ellipse", icon: Circle },
  { kind: "line", label: "Line", icon: Minus },
  { kind: "straightConnector1", label: "Connector", icon: Workflow },
  { kind: "triangle", label: "Triangle", icon: Triangle },
  { kind: "diamond", label: "Diamond", icon: Diamond },
  { kind: "parallelogram", label: "Parallelogram", icon: Square },
  { kind: "trapezoid", label: "Trapezoid", icon: Square },
  { kind: "pentagon", label: "Pentagon", icon: Pentagon },
  { kind: "hexagon", label: "Hexagon", icon: Hexagon },
  { kind: "rightArrow", label: "Right arrow", icon: ArrowRight },
  { kind: "leftArrow", label: "Left arrow", icon: ArrowLeft },
  { kind: "upArrow", label: "Up arrow", icon: ArrowUp },
  { kind: "downArrow", label: "Down arrow", icon: ArrowDown },
  { kind: "leftRightArrow", label: "Left-right arrow", icon: ArrowLeftRight },
  { kind: "star5", label: "Star", icon: Star },
  { kind: "heart", label: "Heart", icon: Heart },
  { kind: "cloud", label: "Cloud", icon: Cloud },
];

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

  function updateSlideSolidBackground(color: string) {
    onUpdateSlide({
      backgroundKind: "solid",
      backgroundColor: color,
      backgroundGradientStart: undefined,
      backgroundGradientEnd: undefined,
      backgroundGradientAngle: undefined,
      backgroundImageRelationshipId: undefined,
      backgroundImageMediaPath: undefined,
      backgroundImageMimeType: undefined,
      backgroundImageDataUrl: undefined,
      backgroundSourceXml: undefined,
    });
  }

  function updateSlideGradientBackground(patch: Partial<PptxSlide> = {}) {
    onUpdateSlide({
      backgroundKind: "gradient",
      backgroundColor: undefined,
      backgroundGradientStart:
        patch.backgroundGradientStart ??
        slide?.backgroundGradientStart ??
        slide?.backgroundColor ??
        "#ffffff",
      backgroundGradientEnd:
        patch.backgroundGradientEnd ?? slide?.backgroundGradientEnd ?? "#dbeafe",
      backgroundGradientAngle:
        patch.backgroundGradientAngle ?? slide?.backgroundGradientAngle ?? 90,
      backgroundImageRelationshipId: undefined,
      backgroundImageMediaPath: undefined,
      backgroundImageMimeType: undefined,
      backgroundImageDataUrl: undefined,
      backgroundSourceXml: undefined,
    });
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

  function updateActiveImageCrop(key: PptxImageCropKey, value: number) {
    onUpdateActiveImage({ [key]: clampPptxCropPercent(value) });
  }

  const tableStyleOptions = buildPptxTableStyleOptions(model, activeTable);

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
      <div
        className="inline-flex h-8 items-center gap-0.5 rounded-md border border-[var(--border)] px-1 text-xs text-[var(--text-muted)]"
        title="Shape gallery"
      >
        {PPTX_SHAPE_GALLERY.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onAddShape(kind)}
            disabled={!slide}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            title={label}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>
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
          disabled={(!activeText && !activeShape) || isPptxLineShape(activeShape)}
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
          {isPptxLineShape(activeShape) && (
            <>
              <LineArrowSelect
                label="Start"
                value={activeShape.lineStartArrow ?? "none"}
                onChange={(lineStartArrow) =>
                  onUpdateActiveShape({ lineStartArrow })
                }
              />
              <LineArrowSelect
                label="End"
                value={activeShape.lineEndArrow ?? "none"}
                onChange={(lineEndArrow) => onUpdateActiveShape({ lineEndArrow })}
              />
            </>
          )}
        </>
      )}
      <div
        className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]"
        title="Slide background"
      >
        <span>Slide</span>
        <select
          value={
            slide?.backgroundKind === "gradient"
              ? "gradient"
              : slide?.backgroundKind === "image"
                ? "image"
                : "solid"
          }
          onChange={(event) => {
            if (event.currentTarget.value === "gradient") {
              updateSlideGradientBackground();
            } else if (event.currentTarget.value === "image") {
              onUpdateSlide({
                backgroundKind: "image",
                backgroundColor: undefined,
                backgroundGradientStart: undefined,
                backgroundGradientEnd: undefined,
                backgroundGradientAngle: undefined,
                backgroundSourceXml: undefined,
              });
            } else {
              updateSlideSolidBackground(slide?.backgroundColor ?? "#ffffff");
            }
          }}
          disabled={!slide}
          className="h-6 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
          <option value="image">Image</option>
        </select>
        {slide?.backgroundKind === "gradient" ? (
          <>
            <input
              type="color"
              value={slide.backgroundGradientStart ?? "#ffffff"}
              onChange={(event) =>
                updateSlideGradientBackground({
                  backgroundGradientStart: event.currentTarget.value,
                })
              }
              disabled={!slide}
              className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
              title="Gradient start"
            />
            <input
              type="color"
              value={slide.backgroundGradientEnd ?? "#dbeafe"}
              onChange={(event) =>
                updateSlideGradientBackground({
                  backgroundGradientEnd: event.currentTarget.value,
                })
              }
              disabled={!slide}
              className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
              title="Gradient end"
            />
            <input
              type="number"
              min={0}
              max={359}
              value={slide.backgroundGradientAngle ?? 90}
              onChange={(event) =>
                updateSlideGradientBackground({
                  backgroundGradientAngle: Number(event.currentTarget.value) || 0,
                })
              }
              disabled={!slide}
              className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              title="Gradient angle"
            />
          </>
        ) : slide?.backgroundKind === "image" ? (
          <label className="inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-[var(--border)] px-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
            <ImageIcon className="h-3 w-3" strokeWidth={1.75} />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!slide}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onSetSlideBackgroundImage(file);
              }}
            />
          </label>
        ) : (
          <input
            type="color"
            value={slide?.backgroundColor ?? "#ffffff"}
            onChange={(event) => updateSlideSolidBackground(event.currentTarget.value)}
            disabled={!slide}
            className="h-5 w-6 cursor-pointer bg-transparent disabled:cursor-not-allowed"
          />
        )}
      </div>
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
            <>
              <select
                value={
                  PPTX_CHART_TYPE_OPTIONS.includes(
                    activeChart.type as (typeof PPTX_CHART_TYPE_OPTIONS)[number],
                  )
                    ? activeChart.type
                    : "bar"
                }
                onChange={(event) =>
                  onUpdateActiveChart({ type: event.currentTarget.value })
                }
                className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                title="Chart type"
              >
                {PPTX_CHART_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input
                value={activeChart.title ?? ""}
                onChange={(event) =>
                  onUpdateActiveChart({ title: event.target.value })
                }
                placeholder="Chart title"
                className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </>
          )}
          {activeTable && (
            <>
              <select
                value={activeTable.tableStyleId ?? PPTX_DEFAULT_TABLE_STYLE_ID}
                onChange={(event) =>
                  onUpdateActiveTable({ tableStyleId: event.currentTarget.value })
                }
                className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                title="Table style"
              >
                {tableStyleOptions.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
              <PptxTableFlagToggle
                label="Header"
                checked={activeTable.firstRow !== false}
                onChange={(firstRow) => onUpdateActiveTable({ firstRow })}
              />
              <PptxTableFlagToggle
                label="Total"
                checked={Boolean(activeTable.lastRow)}
                onChange={(lastRow) => onUpdateActiveTable({ lastRow })}
              />
              <PptxTableFlagToggle
                label="First col"
                checked={Boolean(activeTable.firstColumn)}
                onChange={(firstColumn) => onUpdateActiveTable({ firstColumn })}
              />
              <PptxTableFlagToggle
                label="Last col"
                checked={Boolean(activeTable.lastColumn)}
                onChange={(lastColumn) => onUpdateActiveTable({ lastColumn })}
              />
              <PptxTableFlagToggle
                label="Banded rows"
                checked={activeTable.bandedRows !== false}
                onChange={(bandedRows) => onUpdateActiveTable({ bandedRows })}
              />
              <PptxTableFlagToggle
                label="Banded cols"
                checked={Boolean(activeTable.bandedColumns)}
                onChange={(bandedColumns) =>
                  onUpdateActiveTable({ bandedColumns })
                }
              />
            </>
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
          {activeImage &&
            PPTX_IMAGE_CROP_CONTROLS.map((control) => (
              <PercentInput
                key={control.key}
                label={control.label}
                value={activeImage[control.key] ?? 0}
                min={0}
                max={95}
                onChange={(value) => updateActiveImageCrop(control.key, value)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function LineArrowSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PptxLineArrow;
  onChange: (value: PptxLineArrow) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PptxLineArrow)}
        className="h-6 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      >
        {PPTX_LINE_ARROW_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PptxTableFlagToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}

function buildPptxTableStyleOptions(
  model: PptxModel,
  activeTable: PptxTable | undefined,
) {
  const options = new Map<string, string>();
  options.set(PPTX_DEFAULT_TABLE_STYLE_ID, "Default");
  for (const style of model.tableStyles ?? []) {
    options.set(style.id, style.name ?? style.id);
  }
  if (activeTable?.tableStyleId && !options.has(activeTable.tableStyleId)) {
    options.set(activeTable.tableStyleId, "Current style");
  }
  return [...options.entries()].map(([id, name]) => ({ id, name }));
}

function clampPptxCropPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, value));
}
