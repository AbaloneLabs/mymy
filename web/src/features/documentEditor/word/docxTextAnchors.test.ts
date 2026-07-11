import { describe, expect, it } from "vitest";
import type { DocxBlock } from "../shared/models";
import {
  addDocxCommentRange,
  docxBlockWithTransformedAnchors,
  mergeDocxBlockAnchors,
  setDocxHyperlinkRange,
  splitDocxBlockAnchors,
} from "./docxTextAnchors";

const paragraph: DocxBlock = {
  id: "p1",
  type: "paragraph",
  text: "alpha beta gamma",
  runs: [{ text: "alpha ", bold: true }, { text: "beta gamma" }],
};

describe("DOCX text anchors", () => {
  it("keeps a substring comment and link scoped through edits", () => {
    const commented = addDocxCommentRange(paragraph, { start: 6, end: 10 }, "7");
    expect("block" in commented).toBe(true);
    if (!("block" in commented)) return;
    const linked = setDocxHyperlinkRange(
      commented.block,
      { start: 6, end: 10 },
      "https://example.com",
    );
    expect("block" in linked).toBe(true);
    if (!("block" in linked)) return;

    const insertedBefore = docxBlockWithTransformedAnchors(linked.block, 0, 0, 2);
    expect(insertedBefore.commentRanges).toEqual([
      expect.objectContaining({ commentId: "7", start: 8, end: 12 }),
    ]);
    expect(insertedBefore.hyperlinks).toEqual([
      expect.objectContaining({ start: 8, end: 12, target: "https://example.com" }),
    ]);

    const insertedAtEnd = docxBlockWithTransformedAnchors(linked.block, 10, 10, 1);
    expect(insertedAtEnd.commentRanges?.[0]).toEqual(
      expect.objectContaining({ start: 6, end: 10 }),
    );
  });

  it("splits and recombines a comment that crosses a paragraph boundary", () => {
    const block: DocxBlock = {
      ...paragraph,
      commentRanges: [{ commentId: "3", start: 2, end: 12 }],
      hyperlinks: [
        { id: "link-1", start: 4, end: 14, target: "https://example.com" },
      ],
    };
    const split = splitDocxBlockAnchors(block, 8);
    expect(split.before.commentRanges).toEqual([
      expect.objectContaining({ start: 2, end: 8, endsHere: false }),
    ]);
    expect(split.after.commentRanges).toEqual([
      expect.objectContaining({ start: 0, end: 4, startsHere: false }),
    ]);

    const merged = mergeDocxBlockAnchors(
      { ...block, text: block.text.slice(0, 8), ...split.before },
      { ...block, id: "p2", text: block.text.slice(8), ...split.after },
    );
    expect(merged.commentRanges).toEqual([
      expect.objectContaining({ commentId: "3", start: 2, end: 12 }),
    ]);
    expect(merged.hyperlinks).toEqual([
      expect.objectContaining({ start: 4, end: 14, target: "https://example.com" }),
    ]);
  });

  it("rejects crossing comments while allowing nested ranges", () => {
    const block: DocxBlock = {
      ...paragraph,
      commentRanges: [{ commentId: "1", start: 2, end: 8 }],
    };
    expect(addDocxCommentRange(block, { start: 5, end: 10 }, "2")).toEqual({
      reason: "Comment #1 crosses this selection; use a nested or disjoint range",
    });
    expect(addDocxCommentRange(block, { start: 3, end: 7 }, "2")).toHaveProperty(
      "block",
    );
  });

  it("removes a deleted hyperlink without touching adjacent links", () => {
    const block: DocxBlock = {
      ...paragraph,
      hyperlinks: [
        { id: "a", start: 0, end: 5, target: "https://a.example" },
        { id: "b", start: 6, end: 10, target: "https://b.example" },
      ],
    };
    const removed = setDocxHyperlinkRange(block, { start: 6, end: 10 }, undefined);
    expect(removed).toEqual({
      block: expect.objectContaining({
        hyperlinks: [{ id: "a", start: 0, end: 5, target: "https://a.example" }],
      }),
    });
  });
});
