import { Image as ImageIcon } from "lucide-react";
import type { PptxEditorToolbarProps } from "./pptxEditorToolbarTypes";
import type { PptxSlide } from "../shared/models";

type PptxSlideBackgroundControlsProps = Pick<
  PptxEditorToolbarProps,
  "onSetSlideBackgroundImage" | "onUpdateSlide" | "slide"
>;

export function PptxSlideBackgroundControls({
  onSetSlideBackgroundImage,
  onUpdateSlide,
  slide,
}: PptxSlideBackgroundControlsProps) {
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

  return (
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
  );
}
