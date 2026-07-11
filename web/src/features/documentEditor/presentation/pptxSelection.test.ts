import { describe, expect, test } from "vitest";
import type { PptxSlide } from "../shared/models";
import { restoredPptxSelection } from "./pptxSelection";

const slide = {
  id: "slide-1",
  name: "Slide 1",
  texts: [{ id: "text-1", text: "Title" }],
  shapes: [{ id: "shape-1", kind: "rect" }],
} as PptxSlide;

describe("presentation transaction selection", () => {
  test("restores the exact pre-transaction selection", () => {
    expect(
      restoredPptxSelection(slide, ["text:text-1"], "text:text-1"),
    ).toEqual({
      selectedKeys: ["text:text-1"],
      activeKey: "text:text-1",
    });
  });

  test("drops deleted targets and keeps a valid remaining active object", () => {
    expect(
      restoredPptxSelection(
        slide,
        ["shape:deleted", "text:text-1"],
        "shape:deleted",
      ),
    ).toEqual({
      selectedKeys: ["text:text-1"],
      activeKey: "text:text-1",
    });
  });
});
