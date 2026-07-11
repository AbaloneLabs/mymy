import { afterEach, describe, expect, test, vi } from "vitest";
import { createMarkdownReferenceActions } from "./markdownReferenceActions";
import { markdownReferences } from "./markdownReferenceUtils";

afterEach(() => vi.unstubAllGlobals());

describe("Markdown parsed reference spans", () => {
  test("patches a nested destination without changing its optional title", () => {
    const source = 'Before [label](docs/a_(b).md "Keep title") after';
    const reference = markdownReferences(source).find(
      (candidate) => candidate.kind === "link",
    );
    expect(reference?.target).toBe("docs/a_(b).md");
    let updated = source;
    createMarkdownReferenceActions({
      content: source,
      updateContent: (content) => {
        updated = content;
      },
    }).updateMarkdownReferenceTarget(reference!, "docs/c_(d).md");
    expect(updated).toBe('Before [label](docs/c_(d).md "Keep title") after');
  });

  test("preserves escaped labels and angle destination spelling", () => {
    const source = String.raw`[a \] label](<docs/a b.md> "Title")`;
    const reference = markdownReferences(source)[0];
    expect(reference.label).toBe(String.raw`a \] label`);
    expect(reference.target).toBe("docs/a b.md");
    expect(reference.targetWrapper).toBe("angle");
    expect(reference.targetEditable).toBe(true);
  });

  test("does not discover references inside fenced code", () => {
    const source = "```md\n[not a link](bad)\n```\n\n[real](good)";
    expect(markdownReferences(source).map((reference) => reference.target)).toEqual([
      "good",
    ]);
  });

  test("keeps reference-style uses source-only", () => {
    const source = "Read [the guide][guide].\n\n[guide]: docs/guide.md";
    const references = markdownReferences(source);
    expect(references.some((reference) => reference.role === "reference")).toBe(
      true,
    );
    expect(
      references.find((reference) => reference.role === "reference")
        ?.labelEditable,
    ).toBe(false);
    expect(
      references.find((reference) => reference.role === "definition")
        ?.targetEditable,
    ).toBe(true);
  });
});

describe("Markdown atomic footnote rename", () => {
  const source = "[^Note]: Body\n\nFirst[^note] and second[^NOTE].";

  test("cancels without changing any source span", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const definition = markdownReferences(source).find(
      (reference) =>
        reference.kind === "footnote" && reference.role === "definition",
    );
    let updated = source;
    createMarkdownReferenceActions({
      content: source,
      updateContent: (content) => {
        updated = content;
      },
    }).updateMarkdownReferenceLabel(definition!, "renamed");
    expect(updated).toBe(source);
  });

  test("renames the definition and every use in one content update", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const definition = markdownReferences(source).find(
      (reference) =>
        reference.kind === "footnote" && reference.role === "definition",
    );
    const updates: string[] = [];
    createMarkdownReferenceActions({
      content: source,
      updateContent: (content) => updates.push(content),
    }).updateMarkdownReferenceLabel(definition!, "renamed");
    expect(updates).toEqual([
      "[^renamed]: Body\n\nFirst[^renamed] and second[^renamed].",
    ]);
  });
});
