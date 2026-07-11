import { describe, expect, test } from "vitest";
import type { PptxSlide } from "../shared/models";
import {
  deletePptxObjectsWithDependents,
  pptxDeletionImpact,
} from "./pptxReferenceGraph";
import { pptxSelectionKey } from "./pptxSelection";

const slide: PptxSlide = {
  id: "ppt/slides/slide1.xml",
  name: "slide1.xml",
  texts: [
    { id: "t1", shapeId: "4", text: "Animated" },
    { id: "t2", shapeId: "8", text: "Keep" },
  ],
  animations: [
    { id: "a", targetShapeId: "4" },
    { id: "b", targetShapeId: "8" },
  ],
  media: [
    { id: "m1", shapeId: "4", relationshipId: "rId7" },
    { id: "m2", shapeId: "99", relationshipId: "rId8" },
  ],
};

describe("PPTX reference graph", () => {
  test("previews and removes only dependents of the confirmed object", () => {
    const keys = new Set([pptxSelectionKey("text", "t1")]);
    expect(pptxDeletionImpact(slide, keys)).toEqual({
      animationIds: ["a"],
      mediaIds: ["m1"],
      shapeIds: ["4"],
    });

    const next = deletePptxObjectsWithDependents(slide, keys);
    expect(next.texts.map((item) => item.id)).toEqual(["t2"]);
    expect(next.animations?.map((item) => item.id)).toEqual(["b"]);
    expect(next.media?.map((item) => item.id)).toEqual(["m2"]);
    expect(slide).toEqual({ ...slide });
  });
});
