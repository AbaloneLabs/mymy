import type { PptxImage, PptxShape } from "../shared/models";
import { isPptxLineShape } from "./pptxEditorUtils";

export function PptxShapeView({ shape }: { shape: PptxShape }) {
  const strokeWidth = Math.max(0, shape.strokeWidth ?? 2);
  const strokeColor = shape.strokeColor ?? "#111827";
  const fillColor = isPptxLineShape(shape)
    ? "none"
    : (shape.fillColor ?? "transparent");
  if (isPptxLineShape(shape)) {
    const markerPrefix = shape.id.replace(/[^A-Za-z0-9_-]/g, "_");
    const startMarker = pptxLineMarkerId(markerPrefix, "start", shape.lineStartArrow);
    const endMarker = pptxLineMarkerId(markerPrefix, "end", shape.lineEndArrow);
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        {(startMarker || endMarker) && (
          <defs>
            {startMarker && (
              <PptxLineMarker
                id={startMarker}
                type={shape.lineStartArrow}
                color={strokeColor}
              />
            )}
            {endMarker && (
              <PptxLineMarker
                id={endMarker}
                type={shape.lineEndArrow}
                color={strokeColor}
              />
            )}
          </defs>
        )}
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          stroke={strokeColor}
          strokeWidth={Math.max(1, strokeWidth)}
          markerStart={startMarker ? `url(#${startMarker})` : undefined}
          markerEnd={endMarker ? `url(#${endMarker})` : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "roundRect") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="12"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "ellipse") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <ellipse
          cx="50"
          cy="50"
          rx="48"
          ry="48"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "triangle") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "diamond") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,50 50,98 2,50"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "parallelogram") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="24,2 98,2 76,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "trapezoid") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="22,2 78,2 98,98 2,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "pentagon") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,2 98,38 80,98 20,98 2,38"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "hexagon") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="25,2 75,2 98,50 75,98 25,98 2,50"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "rightArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="2,34 62,34 62,14 98,50 62,86 62,66 2,66"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "leftArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="98,34 38,34 38,14 2,50 38,86 38,66 98,66"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "upArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="34,98 34,38 14,38 50,2 86,38 66,38 66,98"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "downArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="34,2 34,62 14,62 50,98 86,62 66,62 66,2"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "leftRightArrow") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="2,50 24,24 24,38 76,38 76,24 98,50 76,76 76,62 24,62 24,76"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "star5") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <polygon
          points="50,3 61,36 96,36 68,57 79,92 50,71 21,92 32,57 4,36 39,36"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "heart") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d="M50 90 C18 62 4 45 8 25 C12 6 36 3 50 22 C64 3 88 6 92 25 C96 45 82 62 50 90 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (shape.kind === "cloud") {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <path
          d="M24 78 C12 78 4 69 6 58 C8 48 17 42 27 44 C29 29 42 18 58 22 C70 25 78 34 80 46 C90 47 98 55 98 66 C98 76 89 84 78 84 L24 84 C24 84 24 78 24 78 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <rect
        x="1"
        y="1"
        width="98"
        height="98"
        rx="3"
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function pptxLineMarkerId(
  prefix: string,
  edge: "start" | "end",
  type: PptxShape["lineStartArrow"],
) {
  if (!type || type === "none") return null;
  return `pptx-line-${prefix}-${edge}-${type}`;
}

function PptxLineMarker({
  id,
  type,
  color,
}: {
  id: string;
  type: PptxShape["lineStartArrow"];
  color: string;
}) {
  if (!type || type === "none") return null;
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
      markerUnits="strokeWidth"
    >
      {type === "diamond" ? (
        <polygon points="0,5 5,0 10,5 5,10" fill={color} />
      ) : type === "oval" ? (
        <ellipse cx="5" cy="5" rx="4.5" ry="4.5" fill={color} />
      ) : type === "stealth" ? (
        <path d="M 0 0 L 10 5 L 0 10 L 3 5 Z" fill={color} />
      ) : (
        <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} />
      )}
    </marker>
  );
}

export function PptxImageView({ image }: { image: PptxImage }) {
  const crop = pptxImageCropBox(image);
  if (!image.dataUrl) {
    return (
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden border border-dashed border-neutral-300 bg-neutral-50 px-2 text-center text-[10px] text-neutral-500"
        style={{ clipPath: crop.clipPath }}
      >
        {image.mediaPath ?? "Image"}
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <img
        src={image.dataUrl}
        alt={image.altText ?? image.mediaPath ?? "Slide image"}
        draggable={false}
        className="h-full w-full object-fill"
        style={crop.imageStyle}
      />
    </div>
  );
}

function pptxImageCropBox(image: PptxImage) {
  const left = clampPptxCropPercent(image.imageCropLeft);
  const top = clampPptxCropPercent(image.imageCropTop);
  const right = clampPptxCropPercent(image.imageCropRight);
  const bottom = clampPptxCropPercent(image.imageCropBottom);
  const visibleWidth = Math.max(1, 100 - left - right);
  const visibleHeight = Math.max(1, 100 - top - bottom);
  return {
    clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`,
    imageStyle: {
      width: `${(100 / visibleWidth) * 100}%`,
      height: `${(100 / visibleHeight) * 100}%`,
      transform: `translate(${-left}%, ${-top}%)`,
      transformOrigin: "top left",
    },
  };
}

function clampPptxCropPercent(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, Number(value)));
}
