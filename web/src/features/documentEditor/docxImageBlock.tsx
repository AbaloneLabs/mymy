import { Crop, Image as ImageIcon, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { DocxBlock } from "./models";
import {
  clampImageDimension,
  clampImageCropPercent,
  clampImageRotation,
} from "./docxEditorUtils";

type DocxImageCropKey = keyof Pick<
  DocxBlock,
  "imageCropLeft" | "imageCropTop" | "imageCropRight" | "imageCropBottom"
>;

const DOCX_IMAGE_CROP_CONTROLS: Array<{
  key: DocxImageCropKey;
  label: string;
}> = [
  { key: "imageCropLeft", label: "L" },
  { key: "imageCropTop", label: "T" },
  { key: "imageCropRight", label: "R" },
  { key: "imageCropBottom", label: "B" },
];

export function DocxImageBlock({
  block,
  active,
  onFocus,
  onChange,
}: {
  block: DocxBlock;
  active: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<DocxBlock>) => void;
}) {
  const { t } = useTranslation();
  const width = Math.round(block.width ?? 320);
  const height = Math.round(block.height ?? 180);
  const rotation = clampImageRotation(block.imageRotation ?? 0);
  const cropLeft = clampImageCropPercent(block.imageCropLeft ?? 0);
  const cropTop = clampImageCropPercent(block.imageCropTop ?? 0);
  const cropRight = clampImageCropPercent(block.imageCropRight ?? 0);
  const cropBottom = clampImageCropPercent(block.imageCropBottom ?? 0);
  const aspect = width > 0 && height > 0 ? width / height : 1;

  function updateWidth(nextWidth: number) {
    const cleanWidth = clampImageDimension(nextWidth);
    onChange({ width: cleanWidth, height: clampImageDimension(cleanWidth / aspect) });
  }

  function updateHeight(nextHeight: number) {
    const cleanHeight = clampImageDimension(nextHeight);
    onChange({ height: cleanHeight, width: clampImageDimension(cleanHeight * aspect) });
  }

  function updateRotation(nextRotation: number) {
    onChange({ imageRotation: clampImageRotation(nextRotation) });
  }

  function updateCrop(key: DocxImageCropKey, value: number) {
    onChange({ [key]: clampImageCropPercent(value) });
  }

  return (
    <figure
      tabIndex={0}
      onFocus={onFocus}
      onClick={onFocus}
      className={cn(
        "group my-3 rounded-sm px-1 py-2 outline-none",
        active && "ring-1 ring-[var(--accent)]/40",
      )}
    >
      <div className="flex justify-center">
        {block.dataUrl ? (
          <img
            src={block.dataUrl}
            alt={block.altText ?? ""}
            className="max-w-full rounded-sm border border-neutral-200 object-contain"
            style={{
              width,
              height,
              clipPath: `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`,
              transform: `rotate(${rotation}deg)`,
            }}
            draggable={false}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-sm border border-dashed border-neutral-300 text-neutral-500"
            style={{
              width,
              height,
              clipPath: `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
          </div>
        )}
      </div>
      {active && (
        <figcaption className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-600">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_96px_96px_96px]">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                Alt
              </span>
              <input
                value={block.altText ?? ""}
                onChange={(event) => onChange({ altText: event.target.value })}
                placeholder={t("documentEditor.altText", {
                  defaultValue: "Alternative text",
                })}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                W
              </span>
              <input
                type="number"
                min={16}
                max={10_000}
                value={width}
                onChange={(event) => updateWidth(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                H
              </span>
              <input
                type="number"
                min={16}
                max={10_000}
                value={height}
                onChange={(event) => updateHeight(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label>
              <span className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-400">
                <RotateCw className="h-3 w-3" strokeWidth={1.75} />
                Rot
              </span>
              <input
                type="number"
                min={-360}
                max={360}
                value={rotation}
                onChange={(event) => updateRotation(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            {DOCX_IMAGE_CROP_CONTROLS.map(({ key, label }) => {
              const value =
                key === "imageCropLeft"
                  ? cropLeft
                  : key === "imageCropTop"
                    ? cropTop
                    : key === "imageCropRight"
                      ? cropRight
                      : cropBottom;
              return (
                <label key={key} className="min-w-0">
                  <span className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-400">
                    <Crop className="h-3 w-3" strokeWidth={1.75} />
                    {label}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={value}
                    onChange={(event) =>
                      updateCrop(key, Number(event.target.value))
                    }
                    className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 outline-none focus:border-[var(--accent)]"
                  />
                </label>
              );
            })}
          </div>
          {block.mediaPath && (
            <div className="mt-1 truncate font-mono text-[10px] text-neutral-400">
              {block.mediaPath}
            </div>
          )}
        </figcaption>
      )}
    </figure>
  );
}
