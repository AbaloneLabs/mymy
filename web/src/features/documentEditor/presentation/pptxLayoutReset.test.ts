import { describe, expect, test } from "vitest";
import type { PptxLayout, PptxSlide } from "../shared/models";
import { resetPptxSlideToLayout } from "./pptxLayoutReset";

describe("PPTX layout reset", () => {
  test("resets placeholder presentation without deleting user content", () => {
    const slide: PptxSlide = {
      id: "ppt/slides/slide1.xml",
      name: "slide1.xml",
      texts: [
        {
          id: "title",
          shapeId: "4",
          text: "User title",
          placeholderType: "title",
          x: 1,
        },
        { id: "user", shapeId: "9", text: "User box", x: 25 },
      ],
      shapes: [{ id: "s1", shapeId: "12", kind: "rect" }],
    };
    const layout: PptxLayout = {
      path: "ppt/slideLayouts/slideLayout1.xml",
      placeholderTexts: [
        { id: "layout-title", text: "Title", placeholderType: "title", x: 10 },
        { id: "layout-body", text: "Body", placeholderType: "body", x: 15 },
      ],
    };

    const result = resetPptxSlideToLayout(slide, layout);
    expect(result.preview).toEqual({
      matchedPlaceholderCount: 1,
      createdPlaceholderCount: 1,
      preservedObjectCount: 2,
    });
    expect(result.slide.texts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "user", text: "User box", x: 25 }),
        expect.objectContaining({
          id: "title",
          shapeId: "4",
          text: "User title",
          x: 10,
        }),
        expect.objectContaining({ placeholderType: "body", x: 15 }),
      ]),
    );
    expect(slide.texts).toHaveLength(2);
  });
});
