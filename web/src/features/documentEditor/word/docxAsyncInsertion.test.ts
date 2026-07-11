import { describe, expect, test } from "vitest";

import { insertDocxBlockAtStableAnchor } from "./docxAsyncInsertion";
import type { DocxBlock, DocxModel } from "../shared/models";

const image: DocxBlock = { id: "image", type: "image", text: "" };

describe("DOCX asynchronous insertion rebasing", () => {
  test("keeps edits made after the operation started", () => {
    const latest: DocxModel = {
      blocks: [
        { id: "anchor", type: "paragraph", text: "edited while pending" },
        { id: "later", type: "paragraph", text: "new block" },
      ],
    };

    const result = insertDocxBlockAtStableAnchor(latest, "anchor", image);

    expect(result).toMatchObject({
      model: {
        blocks: [
          { id: "anchor", text: "edited while pending" },
          { id: "image" },
          { id: "later", text: "new block" },
        ],
      },
    });
  });

  test("does not guess a new target after the anchor was deleted", () => {
    expect(
      insertDocxBlockAtStableAnchor(
        { blocks: [{ id: "other", type: "paragraph", text: "" }] },
        "deleted",
        image,
      ),
    ).toEqual({ reason: "The insertion paragraph was deleted" });
  });
});
