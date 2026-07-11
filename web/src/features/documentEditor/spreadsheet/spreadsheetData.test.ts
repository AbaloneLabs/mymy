import { describe, expect, test } from "vitest";
import {
  clipboardTextToMatrix,
  delimitedSortBlockReason,
  rangeToClipboardText,
  sortedDelimitedRowIndexes,
} from "./spreadsheetData";

describe("delimited clipboard text", () => {
  test("round-trips tabs, newlines, quotes, and trailing empty cells", () => {
    const matrix = [
      ["plain", "tab\tinside", "line one\nline two", "quote \" value", ""],
      ["last", "", "", "", ""],
    ];
    expect(clipboardTextToMatrix(rangeToClipboardText(matrix))).toEqual(matrix);
  });

  test("parses external quoted CSV without splitting embedded records", () => {
    expect(clipboardTextToMatrix('name,note,empty\nA,"one, two",\nB,"x\n y",z')).toEqual([
      ["name", "note", "empty"],
      ["A", "one, two", ""],
      ["B", "x\n y", "z"],
    ]);
  });

  test("sorts selected row identities stably without padding ragged rows", () => {
    const rows = [["header"], ["2", "wide"], ["1"], ["2"]];
    expect(sortedDelimitedRowIndexes(rows, [1, 2, 3], 0, "asc")).toEqual([
      2, 1, 3,
    ]);
    expect(rows[2]).toEqual(["1"]);
    expect(delimitedSortBlockReason([["1"], ["text"]], [0, 1], 0)).toContain(
      "mixes numeric and text",
    );
  });
});
