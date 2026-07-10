import { describe, expect, it } from "vitest";
import {
  applyEditorOperations,
  createEditorOperationEntry,
} from "./operationHistory";

describe("document editor operation history", () => {
  it("records forward and inverse operations that round-trip JSON models", () => {
    const before = {
      blocks: [{ id: "p1", text: "Alpha" }],
      page: { orientation: "portrait" },
    };
    const after = {
      blocks: [
        { id: "p1", text: "Beta" },
        { id: "p2", text: "Gamma" },
      ],
      page: { orientation: "landscape" },
    };

    const entry = createEditorOperationEntry({ before, after, label: "Edit blocks" });

    expect(entry).not.toBeNull();
    expect(applyEditorOperations(before, entry?.forward ?? [])).toEqual(after);
    expect(applyEditorOperations(after, entry?.inverse ?? [])).toEqual(before);
    expect(entry?.label).toBe("Edit blocks");
  });

  it("does not create an operation when the stable model is unchanged", () => {
    const model = { blocks: [{ id: "p1", text: "Alpha" }] };

    expect(createEditorOperationEntry({ before: model, after: { ...model } })).toBeNull();
  });
});
