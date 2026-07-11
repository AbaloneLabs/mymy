import { describe, expect, test } from "vitest";
import {
  interpolateMarkdownPreviewLine,
  interpolateMarkdownPreviewOffset,
} from "./markdownPreviewNavigation";

describe("Markdown source/preview interpolation", () => {
  const points = [
    { line: 10, offset: 100 },
    { line: 20, offset: 400 },
    { line: 40, offset: 700 },
  ];

  test("maps sparse source lines to an interpolated preview offset", () => {
    expect(interpolateMarkdownPreviewOffset(points, 15)).toBe(250);
    expect(interpolateMarkdownPreviewOffset(points, 30)).toBe(550);
  });

  test("maps preview scrolling back to an interpolated source line", () => {
    expect(interpolateMarkdownPreviewLine(points, 250)).toBe(15);
    expect(interpolateMarkdownPreviewLine(points, 550)).toBe(30);
  });

  test("clamps outside the known source range", () => {
    expect(interpolateMarkdownPreviewOffset(points, 1)).toBe(100);
    expect(interpolateMarkdownPreviewLine(points, 900)).toBe(40);
  });
});
