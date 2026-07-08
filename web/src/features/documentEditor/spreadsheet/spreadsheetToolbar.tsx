import { SpreadsheetDataControls } from "./spreadsheetDataControls";
import { SpreadsheetFormatControls } from "./spreadsheetFormatControls";
import { SpreadsheetFormulaBar } from "./spreadsheetFormulaBar";
import { SpreadsheetStructureControls } from "./spreadsheetStructureControls";
import type { SpreadsheetToolbarProps } from "./spreadsheetToolbarTypes";

export function SpreadsheetToolbar({
  activeCellLabel,
  activeCellValue,
  activeCellFormulaMetadata,
  activeCellDisabled,
  onActiveCellLabelChange,
  onActiveCellChange,
  onActiveCellFormulaMetadataChange,
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
}: SpreadsheetToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
      <SpreadsheetFormulaBar
        activeCellDisabled={activeCellDisabled}
        activeCellFormulaMetadata={activeCellFormulaMetadata}
        activeCellLabel={activeCellLabel}
        activeCellValue={activeCellValue}
        showFormulas={showFormulas}
        onActiveCellChange={onActiveCellChange}
        onActiveCellFormulaMetadataChange={onActiveCellFormulaMetadataChange}
        onActiveCellLabelChange={onActiveCellLabelChange}
        onToggleShowFormulas={onToggleShowFormulas}
      />
      <SpreadsheetFormatControls
        activeCellStyle={activeCellStyle}
        canFormat={canFormat}
        onApplyCellStyle={onApplyCellStyle}
        onClearCellFormat={onClearCellFormat}
      />
      <SpreadsheetStructureControls
        activeColumnWidth={activeColumnWidth}
        activeComment={activeComment}
        activeConditionalRule={activeConditionalRule}
        activeDataValidation={activeDataValidation}
        activeHyperlink={activeHyperlink}
        activeRowHeight={activeRowHeight}
        canApplyComment={canApplyComment}
        canApplyConditionalFormatting={canApplyConditionalFormatting}
        canApplyHyperlink={canApplyHyperlink}
        canCreateTable={canCreateTable}
        canHide={canHide}
        canMerge={canMerge}
        canUnmerge={canUnmerge}
        canValidate={canValidate}
        frozenColumns={frozenColumns}
        frozenRows={frozenRows}
        pageMargins={pageMargins}
        pageSetup={pageSetup}
        sheetProtection={sheetProtection}
        onActiveColumnWidthChange={onActiveColumnWidthChange}
        onActiveRowHeightChange={onActiveRowHeightChange}
        onApplyComment={onApplyComment}
        onApplyConditionalFormatting={onApplyConditionalFormatting}
        onApplyDataValidation={onApplyDataValidation}
        onApplyHyperlink={onApplyHyperlink}
        onCreateTable={onCreateTable}
        onFrozenColumnsChange={onFrozenColumnsChange}
        onFrozenRowsChange={onFrozenRowsChange}
        onHideColumns={onHideColumns}
        onHideRows={onHideRows}
        onMergeCells={onMergeCells}
        onSheetSettingsChange={onSheetSettingsChange}
        onUnhideAll={onUnhideAll}
        onUnmergeCells={onUnmergeCells}
      />
      <SpreadsheetDataControls
        autoFilter={autoFilter}
        canClearCell={canClearCell}
        canCopy={canCopy}
        canDeleteColumn={canDeleteColumn}
        canDeleteRow={canDeleteRow}
        canFillDown={canFillDown}
        canFillRight={canFillRight}
        canSetAutoFilter={canSetAutoFilter}
        canSort={canSort}
        filterText={filterText}
        onAddColumn={onAddColumn}
        onAddRow={onAddRow}
        onClearAutoFilter={onClearAutoFilter}
        onClearCell={onClearCell}
        onCopySelection={onCopySelection}
        onDeleteColumn={onDeleteColumn}
        onDeleteRow={onDeleteRow}
        onFillDown={onFillDown}
        onFillRight={onFillRight}
        onFilterTextChange={onFilterTextChange}
        onSetAutoFilter={onSetAutoFilter}
        onSortAsc={onSortAsc}
        onSortDesc={onSortDesc}
      />
    </div>
  );
}
