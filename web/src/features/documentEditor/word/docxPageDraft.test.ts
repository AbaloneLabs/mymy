import { describe, expect, it } from "vitest";
import type { DocxModel } from "../shared/models";
import { applyDocxPageDraft, resolveDocxPageDraftTarget } from "./docxPageDraft";

const model: DocxModel = {
  blocks: [
    { id: "p1", type: "paragraph", text: "First" },
    {
      id: "s1",
      type: "sectionBreak",
      text: "",
      sectionPage: { width: 100, height: 200, orientation: "portrait" },
    },
    { id: "p2", type: "paragraph", text: "Second" },
  ],
  page: { width: 300, height: 400, orientation: "portrait" },
};

describe("DOCX page drafts", () => {
  it("targets the section ending at the next break", () => {
    expect(resolveDocxPageDraftTarget(model, "p1")).toEqual({
      id: "break:s1",
      label: "Section 1 only",
      page: { width: 100, height: 200, orientation: "portrait" },
      breakBlockId: "s1",
    });
    expect(resolveDocxPageDraftTarget(model, "p2")).toEqual({
      id: "final",
      label: "Final section only (section 2)",
      page: { width: 300, height: 400, orientation: "portrait" },
    });
  });

  it("applies one section without normalizing the other", () => {
    const first = resolveDocxPageDraftTarget(model, "p1");
    const changed = applyDocxPageDraft(model, first, {
      width: 200,
      height: 100,
      orientation: "landscape",
    });
    expect(changed.blocks[1].sectionPage).toEqual({
      width: 200,
      height: 100,
      orientation: "landscape",
    });
    expect(changed.page).toEqual(model.page);
    expect(model.blocks[1].sectionPage).toEqual({
      width: 100,
      height: 200,
      orientation: "portrait",
    });
  });
});
