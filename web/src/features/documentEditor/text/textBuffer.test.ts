import { describe, expect, it } from "vitest";
import {
  PieceTableTextBuffer,
  replaceTextLineRange,
  textLineOffsetRanges,
  textLineStartOffsets,
  textLineWindow,
  textLineWindowRange,
} from "./textBuffer";

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

  it("applies visible edits through a piece table without copying untouched pieces", () => {
    const buffer = new PieceTableTextBuffer("alpha\nbeta\ngamma");
    buffer.replace(6, 10, "BETA");
    buffer.replace(0, 0, "start\n");
    buffer.replace(buffer.length - 5, buffer.length, "end");

    expect(buffer.toString()).toBe("start\nalpha\nBETA\nend");
    expect(buffer.slice(6, 11)).toBe("alpha");
  });

  it("indexes a line window without splitting the complete source", () => {
    const content = "one\r\ntwo\nthree\n";
    const starts = textLineStartOffsets(content);

    expect(starts).toEqual([0, 5, 9, 15]);
    expect(textLineWindow(content, starts, 1, 3).map((line) => line.text)).toEqual([
      "two",
      "three",
    ]);
    expect(textLineWindowRange(content.length, starts, 1, 3)).toEqual({
      start: 5,
      end: 15,
    });
  });
});
