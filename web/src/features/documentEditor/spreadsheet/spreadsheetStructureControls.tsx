import { Columns3, Eraser, Table } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  XlsxComment,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheetProtection,
} from "../shared/models";
import {
  SpreadsheetCommentControls,
  SpreadsheetHyperlinkControls,
} from "./spreadsheetLinkCommentControls";
import { SpreadsheetConditionalFormattingControls } from "./spreadsheetConditionalControls";
import { SpreadsheetSheetSettingsControls } from "./spreadsheetSheetSettingsControls";
import { SpreadsheetValidationControls } from "./spreadsheetValidationControls";

export function SpreadsheetStructureControls({
  activeColumnWidth,
  activeRowHeight,
  onActiveColumnWidthChange,
  onActiveRowHeightChange,
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
  onHideRows,
  onHideColumns,
  onUnhideAll,
  frozenRows,
  frozenColumns,
  onFrozenRowsChange,
  onFrozenColumnsChange,
  canMerge = false,
  canUnmerge = false,
  canCreateTable = false,
  canValidate = false,
  canApplyConditionalFormatting = false,
  canApplyHyperlink = false,
  canApplyComment = false,
  canHide = false,
}: {
  activeColumnWidth?: number;
  activeRowHeight?: number;
  onActiveColumnWidthChange?: (value: number) => void;
  onActiveRowHeightChange?: (value: number) => void;
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
  onHideRows?: () => void;
  onHideColumns?: () => void;
  onUnhideAll?: () => void;
  frozenRows?: number;
  frozenColumns?: number;
  onFrozenRowsChange?: (value: number) => void;
  onFrozenColumnsChange?: (value: number) => void;
  canMerge?: boolean;
  canUnmerge?: boolean;
  canCreateTable?: boolean;
  canValidate?: boolean;
  canApplyConditionalFormatting?: boolean;
  canApplyHyperlink?: boolean;
  canApplyComment?: boolean;
  canHide?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
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
          <span>
            {t("documentEditor.frozenColumns", { defaultValue: "Frozen columns" })}
          </span>
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
    </>
  );
}
