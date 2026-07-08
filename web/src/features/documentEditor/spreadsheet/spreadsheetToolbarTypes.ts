import type {
  XlsxCell,
  XlsxComment,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheetProtection,
} from "../shared/models";
import type { XlsxCellStylePatch } from "./spreadsheetPresentation";

export type SpreadsheetToolbarProps = {
  activeCellLabel: string;
  activeCellValue: string;
  activeCellFormulaMetadata?: XlsxCell;
  activeCellDisabled: boolean;
  onActiveCellLabelChange: (value: string) => void;
  onActiveCellChange: (value: string) => void;
  onActiveCellFormulaMetadataChange?: (
    patch: Pick<XlsxCell, "formulaType" | "formulaRef" | "formulaSharedIndex">,
  ) => void;
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
};
