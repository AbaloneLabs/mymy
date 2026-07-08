import { rangeToClipboardText } from "./spreadsheetData";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import { valuesFromXlsxRange } from "./spreadsheetXlsxGridModel";
import type { XlsxSheet } from "../shared/models";

export async function copySpreadsheetSelection({
  columnCount,
  displayGridSheet,
  selectedRanges,
  showFormulas,
}: {
  columnCount: number;
  displayGridSheet: XlsxSheet | undefined;
  selectedRanges: NormalizedCellRange[];
  showFormulas: boolean;
}) {
  if (!displayGridSheet || selectedRanges.length === 0) return;
  const text = selectedRanges
    .map((range) =>
      rangeToClipboardText(
        valuesFromXlsxRange(displayGridSheet, columnCount, range, showFormulas),
      ),
    )
    .join("\n\n");
  await navigator.clipboard?.writeText(text);
}
