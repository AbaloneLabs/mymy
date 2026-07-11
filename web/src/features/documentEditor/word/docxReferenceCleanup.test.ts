import { describe, expect, test } from "vitest";

import { deleteDocxBlockAndUnreferencedParts } from "./docxReferenceCleanup";
import type { DocxModel } from "../shared/models";

describe("DOCX block reference cleanup", () => {
  test("keeps shared parts and removes only the final orphan", () => {
    const model: DocxModel = {
      blocks: [
        { id: "a", type: "paragraph", text: "A", commentId: "1" },
        {
          id: "b",
          type: "paragraph",
          text: "B",
          commentId: "1",
          footnoteId: "2",
        },
      ],
      comments: [
        { id: "1", text: "shared" },
        { id: "unrelated", text: "pre-existing orphan" },
      ],
      footnotes: [{ id: "2", kind: "footnote", text: "only B" }],
    };

    const afterA = deleteDocxBlockAndUnreferencedParts(model, "a");
    expect(afterA.comments).toEqual([
      { id: "1", text: "shared" },
      { id: "unrelated", text: "pre-existing orphan" },
    ]);

    const afterB = deleteDocxBlockAndUnreferencedParts(afterA, "b");
    expect(afterB.comments).toEqual([
      { id: "unrelated", text: "pre-existing orphan" },
    ]);
    expect(afterB.footnotes).toEqual([]);
  });
});
