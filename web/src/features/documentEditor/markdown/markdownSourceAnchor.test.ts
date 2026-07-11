import { describe, expect, test } from "vitest";
import {
  rebaseMarkdownSourceAnchor,
  type MarkdownSourceAnchor,
} from "./markdownSourceAnchor";

describe("Markdown pending source anchor", () => {
  test("composes edits before, at, and after a right-affinity cursor", () => {
    let content = "before|after";
    let anchor: MarkdownSourceAnchor = {
      start: 6,
      end: 6,
      affinity: "right",
    };

    const beforeEdit = `B-${content}`;
    anchor = rebaseMarkdownSourceAnchor(anchor, content, beforeEdit);
    content = beforeEdit;
    expect(anchor.start).toBe(8);

    const atEdit = `${content.slice(0, anchor.start)}AT${content.slice(anchor.start)}`;
    anchor = rebaseMarkdownSourceAnchor(anchor, content, atEdit);
    content = atEdit;
    expect(anchor.start).toBe(10);

    const afterEdit = `${content} tail`;
    anchor = rebaseMarkdownSourceAnchor(anchor, content, afterEdit);
    expect(anchor.start).toBe(10);
  });
});
