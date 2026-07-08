import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  RotateCw,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isPptxLineShape } from "./pptxEditorUtils";
import { PercentInput } from "./pptxPercentInput";
import { LineArrowSelect } from "./pptxToolbarControls";
import { FontFamilySelect, ToolbarButton } from "../shared/shared";
import type { PptxEditorToolbarProps } from "./pptxEditorToolbarTypes";

type PptxTextShapeToolbarControlsProps = Pick<
  PptxEditorToolbarProps,
  | "activeObject"
  | "activeShape"
  | "activeText"
  | "hasMultiSelection"
  | "onUpdateActiveShape"
  | "onUpdateActiveText"
> & {
  onRotateActiveObject: () => void;
};

export function PptxTextShapeToolbarControls({
  activeObject,
  activeShape,
  activeText,
  hasMultiSelection,
  onRotateActiveObject,
  onUpdateActiveShape,
  onUpdateActiveText,
}: PptxTextShapeToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
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
        onClick={onRotateActiveObject}
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
    </>
  );
}
