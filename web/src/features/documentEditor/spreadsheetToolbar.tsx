import { useState } from "react";
import type { ComponentType } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownAZ,
  ArrowRight,
  ArrowUpAZ,
  Bold,
  Columns3,
  Copy,
  Eraser,
  Filter,
  FilterX,
  Italic,
  PaintBucket,
  Palette,
  Sigma,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  WrapText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  XlsxComment,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheetProtection,
} from "./models";
import { FontFamilySelect } from "./shared";
import {
  SpreadsheetCommentControls,
  SpreadsheetConditionalFormattingControls,
  SpreadsheetHyperlinkControls,
  SpreadsheetSheetSettingsControls,
  SpreadsheetValidationControls,
} from "./spreadsheetAdvancedControls";
import type { SpreadsheetFormulaFunction } from "./spreadsheetFormula";
import {
  applySpreadsheetFormulaSuggestion,
  spreadsheetFormulaSuggestions,
} from "./spreadsheetPresentation";
import type { XlsxCellStylePatch } from "./spreadsheetPresentation";

const XLSX_FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"];
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

export function SpreadsheetToolbar({
  activeCellLabel,
  activeCellValue,
  activeCellDisabled,
  onActiveCellLabelChange,
  onActiveCellChange,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onDeleteColumn,
  onClearCell,
  onCopySelection,
  onFillDown,
  onFillRight,
  onSortAsc,
  onSortDesc,
  filterText,
  onFilterTextChange,
  autoFilter,
  onSetAutoFilter,
  onClearAutoFilter,
  showFormulas = false,
  onToggleShowFormulas,
  activeColumnWidth,
  activeRowHeight,
  onActiveColumnWidthChange,
  onActiveRowHeightChange,
  onHideRows,
  onHideColumns,
  onUnhideAll,
  frozenRows,
  frozenColumns,
  onFrozenRowsChange,
  onFrozenColumnsChange,
  onMergeCells,
  onUnmergeCells,
  onCreateTable,
  activeDataValidation,
  onApplyDataValidation,
  activeConditionalRule,
  onApplyConditionalFormatting,
  activeHyperlink,
  onApplyHyperlink,
  activeComment,
  onApplyComment,
  sheetProtection,
  pageMargins,
  pageSetup,
  onSheetSettingsChange,
  activeCellStyle,
  onApplyCellStyle,
  onClearCellFormat,
  canDeleteRow,
  canDeleteColumn,
  canClearCell,
  canCopy,
  canFillDown,
  canFillRight,
  canSetAutoFilter = false,
  canMerge = false,
  canUnmerge = false,
  canCreateTable = false,
  canValidate = false,
  canApplyConditionalFormatting = false,
  canApplyHyperlink = false,
  canApplyComment = false,
  canHide = false,
  canFormat = false,
  canSort,
}: {
  activeCellLabel: string;
  activeCellValue: string;
  activeCellDisabled: boolean;
  onActiveCellLabelChange: (value: string) => void;
  onActiveCellChange: (value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDeleteRow: () => void;
  onDeleteColumn: () => void;
  onClearCell: () => void;
  onCopySelection: () => void;
  onFillDown: () => void;
  onFillRight: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  autoFilter?: string;
  onSetAutoFilter?: () => void;
  onClearAutoFilter?: () => void;
  showFormulas?: boolean;
  onToggleShowFormulas?: () => void;
  activeColumnWidth?: number;
  activeRowHeight?: number;
  onActiveColumnWidthChange?: (value: number) => void;
  onActiveRowHeightChange?: (value: number) => void;
  onHideRows?: () => void;
  onHideColumns?: () => void;
  onUnhideAll?: () => void;
  frozenRows?: number;
  frozenColumns?: number;
  onFrozenRowsChange?: (value: number) => void;
  onFrozenColumnsChange?: (value: number) => void;
  onMergeCells?: () => void;
  onUnmergeCells?: () => void;
  onCreateTable?: () => void;
  activeDataValidation?: XlsxDataValidation;
  onApplyDataValidation?: (validation: XlsxDataValidation | null) => void;
  activeConditionalRule?: XlsxConditionalRule;
  onApplyConditionalFormatting?: (rule: XlsxConditionalRule | null) => void;
  activeHyperlink?: XlsxHyperlink;
  onApplyHyperlink?: (hyperlink: XlsxHyperlink | null) => void;
  activeComment?: XlsxComment;
  onApplyComment?: (comment: XlsxComment | null) => void;
  sheetProtection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  onSheetSettingsChange?: (patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) => void;
  activeCellStyle?: XlsxCellStylePatch;
  onApplyCellStyle?: (patch: XlsxCellStylePatch) => void;
  onClearCellFormat?: () => void;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
  canClearCell: boolean;
  canCopy: boolean;
  canFillDown: boolean;
  canFillRight: boolean;
  canSetAutoFilter?: boolean;
  canMerge?: boolean;
  canUnmerge?: boolean;
  canCreateTable?: boolean;
  canValidate?: boolean;
  canApplyConditionalFormatting?: boolean;
  canApplyHyperlink?: boolean;
  canApplyComment?: boolean;
  canHide?: boolean;
  canFormat?: boolean;
  canSort: boolean;
}) {
  const { t } = useTranslation();
  const numberFormat = activeCellStyle?.numberFormat ?? "";
  const fontSize = activeCellStyle?.fontSize ?? "11";
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false);
  const [formulaSuggestionIndex, setFormulaSuggestionIndex] = useState(0);
  const formulaSuggestions = spreadsheetFormulaSuggestions(activeCellValue);
  const formulaPopoverOpen =
    formulaHelpOpen && !activeCellDisabled && formulaSuggestions.length > 0;

  function applyFormulaSuggestion(suggestion: SpreadsheetFormulaFunction) {
    onActiveCellChange(
      applySpreadsheetFormulaSuggestion(activeCellValue, suggestion.name),
    );
    setFormulaHelpOpen(false);
    setFormulaSuggestionIndex(0);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = data.get("cellReference");
          if (typeof value === "string") onActiveCellLabelChange(value);
        }}
      >
        <input
          key={activeCellLabel}
          name="cellReference"
          defaultValue={activeCellLabel}
          className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:text-[var(--text)]"
          aria-label={t("documentEditor.nameBox", {
            defaultValue: "Name box",
          })}
        />
      </form>
      <div className="relative min-w-72 flex-1">
        <input
          value={activeCellValue}
          onChange={(event) => {
            onActiveCellChange(event.target.value);
            setFormulaHelpOpen(true);
            setFormulaSuggestionIndex(0);
          }}
          onFocus={() => setFormulaHelpOpen(true)}
          onBlur={() => setFormulaHelpOpen(false)}
          onKeyDown={(event) => {
            if (!formulaPopoverOpen) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) =>
                Math.min(current + 1, formulaSuggestions.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              applyFormulaSuggestion(
                formulaSuggestions[
                  Math.min(formulaSuggestionIndex, formulaSuggestions.length - 1)
                ],
              );
            } else if (event.key === "Escape") {
              setFormulaHelpOpen(false);
            }
          }}
          disabled={activeCellDisabled}
          className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={t("documentEditor.formulaBar", { defaultValue: "Formula bar" })}
          aria-autocomplete="list"
        />
        {formulaPopoverOpen && (
          <div className="absolute left-0 right-0 top-9 z-30 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
            {formulaSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyFormulaSuggestion(suggestion);
                }}
                onMouseEnter={() => setFormulaSuggestionIndex(index)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left",
                  index === formulaSuggestionIndex
                    ? "bg-[var(--accent)]/10"
                    : "hover:bg-[var(--surface-hover)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    {suggestion.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {suggestion.signature}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--text-faint)]">
                    {suggestion.category}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-faint)]">
                  {suggestion.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {onToggleShowFormulas && (
        <button
          type="button"
          onClick={onToggleShowFormulas}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            showFormulas && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={t("documentEditor.toggleFormulas", {
            defaultValue: "Toggle formulas",
          })}
        >
          <Sigma className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      {onApplyCellStyle && (
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
      )}
      {onActiveColumnWidthChange && activeColumnWidth !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.columnWidth")}</span>
          <input
            type="number"
            min={4}
            max={80}
            step={0.5}
            value={activeColumnWidth}
            onChange={(event) =>
              onActiveColumnWidthChange(Number(event.currentTarget.value))
            }
            className="h-6 w-14 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onActiveRowHeightChange && activeRowHeight !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.rowHeight")}</span>
          <input
            type="number"
            min={8}
            max={180}
            step={1}
            value={activeRowHeight}
            onChange={(event) =>
              onActiveRowHeightChange(Number(event.currentTarget.value))
            }
            className="h-6 w-14 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onMergeCells && (
        <button
          type="button"
          onClick={onMergeCells}
          disabled={!canMerge}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.mergeCells")}
        </button>
      )}
      {onUnmergeCells && (
        <button
          type="button"
          onClick={onUnmergeCells}
          disabled={!canUnmerge}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.unmergeCells")}
        </button>
      )}
      {onCreateTable && (
        <button
          type="button"
          onClick={onCreateTable}
          disabled={!canCreateTable}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.createTable", { defaultValue: "Create table" })}
        </button>
      )}
      {onApplyDataValidation && (
        <SpreadsheetValidationControls
          validation={activeDataValidation}
          disabled={!canValidate}
          onChange={onApplyDataValidation}
        />
      )}
      {onApplyConditionalFormatting && (
        <SpreadsheetConditionalFormattingControls
          rule={activeConditionalRule}
          disabled={!canApplyConditionalFormatting}
          onChange={onApplyConditionalFormatting}
        />
      )}
      {onApplyHyperlink && (
        <SpreadsheetHyperlinkControls
          hyperlink={activeHyperlink}
          disabled={!canApplyHyperlink}
          onChange={onApplyHyperlink}
        />
      )}
      {onApplyComment && (
        <SpreadsheetCommentControls
          comment={activeComment}
          disabled={!canApplyComment}
          onChange={onApplyComment}
        />
      )}
      {onSheetSettingsChange && (
        <SpreadsheetSheetSettingsControls
          protection={sheetProtection}
          pageMargins={pageMargins}
          pageSetup={pageSetup}
          onChange={onSheetSettingsChange}
        />
      )}
      {onHideRows && (
        <button
          type="button"
          onClick={onHideRows}
          disabled={!canHide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.hideRows")}
        </button>
      )}
      {onHideColumns && (
        <button
          type="button"
          onClick={onHideColumns}
          disabled={!canHide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.hideColumns")}
        </button>
      )}
      {onUnhideAll && (
        <button
          type="button"
          onClick={onUnhideAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.unhideAll")}
        </button>
      )}
      {onFrozenRowsChange && frozenRows !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.frozenRows", { defaultValue: "Frozen rows" })}</span>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={frozenRows}
            onChange={(event) =>
              onFrozenRowsChange(Number(event.currentTarget.value))
            }
            className="h-6 w-12 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onFrozenColumnsChange && frozenColumns !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.frozenColumns", { defaultValue: "Frozen columns" })}</span>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={frozenColumns}
            onChange={(event) =>
              onFrozenColumnsChange(Number(event.currentTarget.value))
            }
            className="h-6 w-12 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      <button
        type="button"
        onClick={onAddRow}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addRow")}
      </button>
      <button
        type="button"
        onClick={onAddColumn}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addColumn")}
      </button>
      <button
        type="button"
        onClick={onCopySelection}
        disabled={!canCopy}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.copyRange", { defaultValue: "Copy range" })}
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillDown}
        disabled={!canFillDown}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillDown", { defaultValue: "Fill down" })}
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillRight}
        disabled={!canFillRight}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillRight", { defaultValue: "Fill right" })}
      >
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortAsc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort ascending"
      >
        <ArrowUpAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortDesc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort descending"
      >
        <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {onSetAutoFilter && (
        <button
          type="button"
          onClick={onSetAutoFilter}
          disabled={!canSetAutoFilter}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40",
            autoFilter && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={
            autoFilter
              ? `Saved XLSX filter range: ${autoFilter}`
              : "Set XLSX filter range"
          }
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
          {autoFilter ?? "Set filter"}
        </button>
      )}
      {onClearAutoFilter && autoFilter && (
        <button
          type="button"
          onClick={onClearAutoFilter}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Clear XLSX filter range"
        >
          <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      <div className="flex h-8 min-w-44 items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2">
        <Filter className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          placeholder="Filter rows"
        />
        {filterText && (
          <button
            type="button"
            onClick={() => onFilterTextChange("")}
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title="Clear filter"
          >
            <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClearCell}
        disabled={!canClearCell}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Clear cell"
      >
        <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteRow}
        disabled={!canDeleteRow}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete row"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteColumn}
        disabled={!canDeleteColumn}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete column"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

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
