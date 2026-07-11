import { rangeToClipboardText } from "./spreadsheetData";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import { valuesFromXlsxRange } from "./spreadsheetXlsxGridModel";
import type { XlsxSheet } from "../shared/models";
import {
  buildXlsxClipboardPayload,
  serializeXlsxClipboardPayload,
  XLSX_CLIPBOARD_MIME,
} from "./spreadsheetXlsxClipboard";

export async function copySpreadsheetSelection({
  columnCount,
  displayGridSheet,
  rawSheet,
  selectedRanges,
  showFormulas,
}: {
  columnCount: number;
  displayGridSheet: XlsxSheet | undefined;
  rawSheet: XlsxSheet | undefined;
  selectedRanges: NormalizedCellRange[];
  showFormulas: boolean;
}) {
  if (!displayGridSheet || !rawSheet || selectedRanges.length === 0) {
    return "Select a workbook range to copy";
  }
  const text = selectedRanges
    .map((range) =>
      rangeToClipboardText(
        valuesFromXlsxRange(displayGridSheet, columnCount, range, showFormulas),
      ),
    )
    .join("\n\n");
  const rich = buildXlsxClipboardPayload(rawSheet, selectedRanges);
  if (
    rich.payload &&
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          [XLSX_CLIPBOARD_MIME]: new Blob(
            [serializeXlsxClipboardPayload(rich.payload)],
            { type: XLSX_CLIPBOARD_MIME },
          ),
        }),
      ]);
      return null;
    } catch {
      // Some browsers reject custom MIME types even when ClipboardItem exists.
      // Multi-range copy must not degrade to ambiguous blank-line-separated
      // text because its geometry cannot be reconstructed on paste.
    }
  }
  if (selectedRanges.length > 1) {
    return (
      rich.reason ??
      "This browser cannot preserve a multi-range workbook clipboard payload"
    );
  }
  if (!navigator.clipboard?.writeText) {
    return "Clipboard access is unavailable in this browser";
  }
  await navigator.clipboard.writeText(text);
  return (
    rich.reason ??
    "Copied interoperable text only; this browser did not accept rich workbook metadata"
  );
}
