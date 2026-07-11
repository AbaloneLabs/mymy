import type { RefObject } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Circle,
  Cloud,
  Copy,
  Diamond,
  EyeOff,
  Heart,
  Hexagon,
  Image as ImageIcon,
  Minus,
  Pentagon,
  Play,
  Plus,
  Square,
  SquareRoundCorner,
  Table as TableIcon,
  Trash2,
  Triangle,
  Type,
  Workflow,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PptxModel, PptxShape, PptxSlide } from "../shared/models";
import {
  PPTX_SLIDE_SIZE_PRESETS,
  pptxEmuToInches,
  pptxInchesToEmu,
  pptxSlideSizePreset,
} from "./pptxEditorUtils";
import type { PptxSlideSizePreset } from "./pptxEditorUtils";

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

export function PptxSlideToolbarControls({
  model,
  slide,
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
  onUpdateModel,
}: {
  model: PptxModel;
  slide: PptxSlide | undefined;
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
  onUpdateModel: (patch: Partial<PptxModel>) => void;
}) {
  const slideSizePreset = pptxSlideSizePreset(model);
  const slideWidthInches = pptxEmuToInches(
    model.slideWidthEmu,
    PPTX_SLIDE_SIZE_PRESETS.widescreen.widthEmu,
  );
  const slideHeightInches = pptxEmuToInches(
    model.slideHeightEmu,
    PPTX_SLIDE_SIZE_PRESETS.widescreen.heightEmu,
  );

  function updateSlideSizePreset(preset: PptxSlideSizePreset) {
    if (preset === "custom") {
      onUpdateModel({
        slideWidthEmu:
          model.slideWidthEmu ?? PPTX_SLIDE_SIZE_PRESETS.widescreen.widthEmu,
        slideHeightEmu:
          model.slideHeightEmu ?? PPTX_SLIDE_SIZE_PRESETS.widescreen.heightEmu,
        slideSizeType: "custom",
      });
      return;
    }
    const size = PPTX_SLIDE_SIZE_PRESETS[preset];
    onUpdateModel({
      slideWidthEmu: size.widthEmu,
      slideHeightEmu: size.heightEmu,
      slideSizeType: size.type,
    });
  }

  function updateCustomSlideSize(axis: "width" | "height", value: string) {
    const inches = Number(value);
    const nextEmu = pptxInchesToEmu(inches);
    onUpdateModel({
      slideWidthEmu:
        axis === "width"
          ? nextEmu
          : model.slideWidthEmu ?? PPTX_SLIDE_SIZE_PRESETS.widescreen.widthEmu,
      slideHeightEmu:
        axis === "height"
          ? nextEmu
          : model.slideHeightEmu ?? PPTX_SLIDE_SIZE_PRESETS.widescreen.heightEmu,
      slideSizeType: "custom",
    });
  }

  return (
    <>
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
      <div className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-1.5 text-xs text-[var(--text-muted)]">
        <select
          value={slideSizePreset}
          onChange={(event) =>
            updateSlideSizePreset(event.target.value as PptxSlideSizePreset)
          }
          className="h-6 rounded border border-transparent bg-[var(--bg)] px-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Slide size"
        >
          {Object.entries(PPTX_SLIDE_SIZE_PRESETS).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <input
          type="number"
          min={1}
          max={100}
          step={0.01}
          value={slideWidthInches.toFixed(2)}
          onChange={(event) => updateCustomSlideSize("width", event.target.value)}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Slide width in inches"
        />
        <span className="text-[10px] text-[var(--text-faint)]">x</span>
        <input
          type="number"
          min={1}
          max={100}
          step={0.01}
          value={slideHeightInches.toFixed(2)}
          onChange={(event) => updateCustomSlideSize("height", event.target.value)}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Slide height in inches"
        />
      </div>
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
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onAddImageFile(file);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
