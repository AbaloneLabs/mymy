import { describe, expect, test } from "vitest";
import { compareAndMergeDocumentModels } from "./documentEditorThreeWayMerge";

describe("document editor three-way merge", () => {
  test("merges independent object and source-text changes", () => {
    const base = { content: "alpha middle omega", meta: { title: "Base" } };
    const local = { content: "ALPHA middle omega", meta: { title: "Base" } };
    const external = {
      content: "alpha middle OMEGA",
      meta: { title: "External" },
    };
    const result = compareAndMergeDocumentModels(base, local, external);
    expect(result.conflictPaths).toEqual([]);
    expect(result.mergedModel).toEqual({
      content: "ALPHA middle OMEGA",
      meta: { title: "External" },
    });
  });

  test("reports overlapping edits and retains the local value", () => {
    const result = compareAndMergeDocumentModels(
      { content: "alpha" },
      { content: "local" },
      { content: "external" },
    );
    expect(result.conflictPaths).toEqual(["$.content"]);
    expect(result.mergedModel).toEqual({ content: "local" });
  });

  test("merges properties on stable OOXML objects without guessing reorders", () => {
    const base = { blocks: [{ id: "p1", text: "A", style: "Normal" }] };
    const local = { blocks: [{ id: "p1", text: "B", style: "Normal" }] };
    const external = { blocks: [{ id: "p1", text: "A", style: "Heading" }] };
    const result = compareAndMergeDocumentModels(base, local, external);
    expect(result.conflictPaths).toEqual([]);
    expect(result.mergedModel).toEqual({
      blocks: [{ id: "p1", text: "B", style: "Heading" }],
    });
  });
});
