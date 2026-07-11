/**
 * Inline editing is a preview until the field loses focus or keyboard
 * navigation commits it. Returning `null` means the workbook and operation
 * history must remain untouched, which gives Escape true A -> A' -> A
 * cancellation instead of recording a compensating edit.
 */
export function spreadsheetCellEditCommitValue(
  originalValue: string,
  draftValue: string,
  cancelled: boolean,
) {
  return !cancelled && draftValue !== originalValue ? draftValue : null;
}
