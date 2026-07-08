import { builtInFontFamilies } from "../shared/fonts";
import type { PptxSlide } from "../shared/models";
import {
  isPptxLineShape,
  pptxChartStyle,
  pptxImageStyle,
  pptxSlideBackgroundStyle,
} from "./pptxEditorUtils";
import { PptxImageView, PptxShapeView } from "./pptxShapeViews";
import { PptxChartView } from "./pptxChartView";
import { PptxTableView } from "./pptxTablePanels";

export function PptxReadOnlySlide({
  slide,
  slideAspectRatio = 16 / 9,
}: {
  slide: PptxSlide;
  slideAspectRatio?: number;
}) {
  return (
    <div
      className="relative w-full max-w-6xl overflow-hidden shadow-2xl"
      style={{
        ...pptxSlideBackgroundStyle(slide),
        aspectRatio: slideAspectRatio,
      }}
    >
      {(slide.shapes ?? []).map((shape, index) => (
        <div
          key={shape.id}
          className="absolute"
          style={{
            left: `${shape.x ?? 24}%`,
            top: `${shape.y ?? 34}%`,
            width: `${shape.width ?? 26}%`,
            height: `${isPptxLineShape(shape) ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
            transform: `rotate(${shape.rotation ?? 0}deg)`,
            zIndex: index + 1,
          }}
        >
          <PptxShapeView shape={shape} />
        </div>
      ))}
      {(slide.images ?? []).map((image, index) => (
        <div
          key={image.id}
          className="absolute"
          style={pptxImageStyle(image, (slide.shapes?.length ?? 0) + index + 1)}
        >
          <PptxImageView image={image} />
        </div>
      ))}
      {(slide.charts ?? []).map((chart, index) => (
        <div
          key={chart.id}
          className="absolute"
          style={pptxChartStyle(
            chart,
            (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              index +
              1,
          )}
        >
          <PptxChartView chart={chart} />
        </div>
      ))}
      {(slide.tables ?? []).map((table, index) => (
        <PptxTableView
          key={table.id}
          table={table}
          zIndex={
            (slide.shapes?.length ?? 0) +
            (slide.images?.length ?? 0) +
            (slide.charts?.length ?? 0) +
            index +
            1
          }
        />
      ))}
      {slide.texts.map((textItem, index) => (
        <div
          key={textItem.id}
          className="absolute whitespace-pre-wrap text-neutral-950"
          style={{
            left: `${textItem.x ?? 10}%`,
            top: `${textItem.y ?? 12 + index * 18}%`,
            width: `${textItem.width ?? 80}%`,
            height: `${textItem.height ?? 10}%`,
            transform: `rotate(${textItem.rotation ?? 0}deg)`,
            zIndex:
              (slide.shapes?.length ?? 0) +
              (slide.images?.length ?? 0) +
              (slide.charts?.length ?? 0) +
              (slide.tables?.length ?? 0) +
              index +
              1,
            fontFamily: textItem.fontFamily ?? builtInFontFamilies[0],
            fontSize: `${textItem.fontSize ?? (index === 0 ? "28" : "18")}px`,
            fontWeight: textItem.bold ? 700 : index === 0 ? 600 : 400,
            fontStyle: textItem.italic ? "italic" : undefined,
            textDecorationLine: [
              textItem.underline ? "underline" : "",
              textItem.strikethrough ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" "),
            textAlign: textItem.align ?? "left",
            color: textItem.color,
            backgroundColor: textItem.fillColor,
          }}
        >
          {textItem.text}
        </div>
      ))}
    </div>
  );
}
