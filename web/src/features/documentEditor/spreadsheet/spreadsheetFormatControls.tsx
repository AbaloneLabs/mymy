import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  PaintBucket,
  Palette,
  Strikethrough,
  Underline,
  WrapText,
} from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FontFamilySelect } from "../shared/shared";
import type { XlsxCellStylePatch } from "./spreadsheetPresentation";

const XLSX_FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"];

/**
 * Shared icon button for the spreadsheet toolbar. Lives here because it is only
 * used by the format controls strip; if another toolbar section needs it later,
 * promote it to a shared module at that point.
 */
function SpreadsheetIconButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40",
        active && "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
const XLSX_NUMBER_FORMATS = [
  { label: "General", value: "" },
  { label: "Number", value: "0.00" },
  { label: "Integer", value: "0" },
  { label: "Percent", value: "0.00%" },
  { label: "Currency", value: "$#,##0.00" },
  { label: "Date", value: "m/d/yy" },
  { label: "Date time", value: "m/d/yy h:mm" },
  { label: "Text", value: "@" },
];

export function SpreadsheetFormatControls({
  activeCellStyle,
  onApplyCellStyle,
  onClearCellFormat,
  canFormat = false,
}: {
  activeCellStyle?: XlsxCellStylePatch;
  onApplyCellStyle?: (patch: XlsxCellStylePatch) => void;
  onClearCellFormat?: () => void;
  canFormat?: boolean;
}) {
  const { t } = useTranslation();
  const numberFormat = activeCellStyle?.numberFormat ?? "";
  const fontSize = activeCellStyle?.fontSize ?? "11";

  if (!onApplyCellStyle) {
    return null;
  }

  return (
    <>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <select
        value={
          XLSX_NUMBER_FORMATS.some((item) => item.value === numberFormat)
            ? numberFormat
            : "__custom"
        }
        onChange={(event) =>
          onApplyCellStyle({
            numberFormat:
              event.currentTarget.value === "__custom"
                ? numberFormat
                : event.currentTarget.value || undefined,
          })
        }
        disabled={!canFormat}
        className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title={t("documentEditor.numberFormat", {
          defaultValue: "Number format",
        })}
      >
        {XLSX_NUMBER_FORMATS.map((item) => (
          <option key={item.label} value={item.value}>
            {item.label}
          </option>
        ))}
        {!XLSX_NUMBER_FORMATS.some((item) => item.value === numberFormat) && (
          <option value="__custom">{numberFormat}</option>
        )}
      </select>
      <FontFamilySelect
        value={activeCellStyle?.fontFamily}
        compact
        onChange={(fontFamily) => onApplyCellStyle({ fontFamily })}
      />
      <select
        value={XLSX_FONT_SIZES.includes(fontSize) ? fontSize : "__custom"}
        onChange={(event) =>
          onApplyCellStyle({
            fontSize:
              event.currentTarget.value === "__custom"
                ? fontSize
                : event.currentTarget.value,
          })
        }
        disabled={!canFormat}
        className="h-8 w-16 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title={t("documentEditor.fontSize", { defaultValue: "Font size" })}
      >
        {XLSX_FONT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
        {!XLSX_FONT_SIZES.includes(fontSize) && (
          <option value="__custom">{fontSize}</option>
        )}
      </select>
      <SpreadsheetIconButton
        icon={Bold}
        label={t("documentEditor.bold", { defaultValue: "Bold" })}
        active={activeCellStyle?.bold === true}
        disabled={!canFormat}
        onClick={() => onApplyCellStyle({ bold: !activeCellStyle?.bold })}
      />
      <SpreadsheetIconButton
        icon={Italic}
        label={t("documentEditor.italic", { defaultValue: "Italic" })}
        active={activeCellStyle?.italic === true}
        disabled={!canFormat}
        onClick={() => onApplyCellStyle({ italic: !activeCellStyle?.italic })}
      />
      <SpreadsheetIconButton
        icon={Underline}
        label={t("documentEditor.underline", { defaultValue: "Underline" })}
        active={activeCellStyle?.underline === true}
        disabled={!canFormat}
        onClick={() =>
          onApplyCellStyle({ underline: !activeCellStyle?.underline })
        }
      />
      <SpreadsheetIconButton
        icon={Strikethrough}
        label={t("documentEditor.strikethrough", {
          defaultValue: "Strikethrough",
        })}
        active={activeCellStyle?.strikethrough === true}
        disabled={!canFormat}
        onClick={() =>
          onApplyCellStyle({
            strikethrough: !activeCellStyle?.strikethrough,
          })
        }
      />
      <label
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          !canFormat && "pointer-events-none opacity-50",
        )}
        title={t("documentEditor.textColor", { defaultValue: "Text color" })}
      >
        <Palette className="h-3.5 w-3.5" strokeWidth={1.75} />
        <input
          type="color"
          value={activeCellStyle?.color ?? "#111827"}
          onChange={(event) => onApplyCellStyle({ color: event.target.value })}
          className="sr-only"
          disabled={!canFormat}
        />
      </label>
      <label
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          !canFormat && "pointer-events-none opacity-50",
        )}
        title={t("documentEditor.fillColor", { defaultValue: "Fill color" })}
      >
        <PaintBucket className="h-3.5 w-3.5" strokeWidth={1.75} />
        <input
          type="color"
          value={activeCellStyle?.fillColor ?? "#ffffff"}
          onChange={(event) =>
            onApplyCellStyle({ fillColor: event.target.value })
          }
          className="sr-only"
          disabled={!canFormat}
        />
      </label>
      <SpreadsheetIconButton
        icon={AlignLeft}
        label={t("documentEditor.alignLeft", { defaultValue: "Align left" })}
        active={activeCellStyle?.align === "left"}
        disabled={!canFormat}
        onClick={() => onApplyCellStyle({ align: "left" })}
      />
      <SpreadsheetIconButton
        icon={AlignCenter}
        label={t("documentEditor.alignCenter", {
          defaultValue: "Align center",
        })}
        active={activeCellStyle?.align === "center"}
        disabled={!canFormat}
        onClick={() => onApplyCellStyle({ align: "center" })}
      />
      <SpreadsheetIconButton
        icon={AlignRight}
        label={t("documentEditor.alignRight", {
          defaultValue: "Align right",
        })}
        active={activeCellStyle?.align === "right"}
        disabled={!canFormat}
        onClick={() => onApplyCellStyle({ align: "right" })}
      />
      <SpreadsheetIconButton
        icon={WrapText}
        label={t("documentEditor.wrapText", { defaultValue: "Wrap text" })}
        active={activeCellStyle?.wrapText === true}
        disabled={!canFormat}
        onClick={() =>
          onApplyCellStyle({ wrapText: !activeCellStyle?.wrapText })
        }
      />
      {onClearCellFormat && (
        <button
          type="button"
          onClick={onClearCellFormat}
          disabled={!canFormat}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.clearFormat", {
            defaultValue: "Clear format",
          })}
        </button>
      )}
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
    </>
  );
}
