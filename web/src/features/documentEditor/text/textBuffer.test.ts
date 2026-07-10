import { describe, expect, it } from "vitest";
import { replaceTextLineRange, textLineOffsetRanges } from "./textBuffer";

describe("text buffer", () => {
  it("maps logical lines to source offsets including newline bytes", () => {
    expect(textLineOffsetRanges("alpha\nbeta\ngamma")).toEqual([
      { start: 0, end: 6 },
      { start: 6, end: 11 },
      { start: 11, end: 16 },
    ]);
  });

  it("replaces a virtualized line window without touching surrounding content", () => {
    const content = "one\ntwo\nthree\nfour";

    expect(
      replaceTextLineRange(content, { startLineIndex: 1, endLineIndex: 3 }, "TWO\nTHREE\n"),
    ).toBe("one\nTWO\nTHREE\nfour");
  });

  it("treats an empty file as one editable zero-length line", () => {
    expect(textLineOffsetRanges("")).toEqual([{ start: 0, end: 0 }]);
    expect(
      replaceTextLineRange("", { startLineIndex: 0, endLineIndex: 1 }, "draft"),
    ).toBe("draft");
  });
});
