export const LARGE_TEXT_FILE_CHAR_LIMIT = 1_000_000;
export const LARGE_TEXT_FILE_LINE_LIMIT = 50_000;
export const LARGE_TEXT_EDITABLE_CHAR_LIMIT = 10_000_000;
export const LARGE_TEXT_EDITABLE_LINE_LIMIT = 500_000;
export const LARGE_TEXT_EDIT_WINDOW_CHAR_LIMIT = 512_000;

export interface LargeTextFilePolicy {
  mode: "normal" | "window-edit" | "read-only";
  contentLength: number;
  lineCount: number;
}

/**
 * These limits keep expensive structured parsing and whole-file transforms
 * out of the large-file path. Files beyond the edit ceiling remain searchable
 * and virtualized, but require an external streaming tool for mutation.
 */
export function largeTextFilePolicy(
  contentLength: number,
  lineCount: number,
): LargeTextFilePolicy {
  if (
    contentLength <= LARGE_TEXT_FILE_CHAR_LIMIT &&
    lineCount <= LARGE_TEXT_FILE_LINE_LIMIT
  ) {
    return { mode: "normal", contentLength, lineCount };
  }
  if (
    contentLength <= LARGE_TEXT_EDITABLE_CHAR_LIMIT &&
    lineCount <= LARGE_TEXT_EDITABLE_LINE_LIMIT
  ) {
    return { mode: "window-edit", contentLength, lineCount };
  }
  return { mode: "read-only", contentLength, lineCount };
}
