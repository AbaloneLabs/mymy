import { describe, expect, test } from "vitest";
import {
  frontmatterStructuralEditBlockReason,
  parseFrontmatterFields,
  updateFrontmatterFieldBody,
} from "./markdownFrontmatter";

describe("Markdown frontmatter lossless fields", () => {
  test("preserves decorators, comments, and spacing through A -> A' -> A", () => {
    const source = "anchor  :  &base value   # keep\nother: true";
    const field = parseFrontmatterFields(source, "---")[0];
    const changed = updateFrontmatterFieldBody(
      source,
      "---",
      field,
      field.key,
      "changed",
    );
    expect(changed).toBe("anchor  :  &base changed   # keep\nother: true");
    const restoredField = parseFrontmatterFields(changed, "---")[0];
    expect(
      updateFrontmatterFieldBody(
        changed,
        "---",
        restoredField,
        restoredField.key,
        "value",
      ),
    ).toBe(source);
  });

  test("marks unsafe fields and ambiguous structural edits source-only", () => {
    const source = "# keep with next field\nflow: [one, { nested: two }]\n";
    const fields = parseFrontmatterFields(source, "---");
    expect(fields[0].editBlockReason).toContain("flow collections");
    expect(frontmatterStructuralEditBlockReason(source, "---")).toBeTruthy();
  });
});
