import { describe, expect, test } from "vitest";

import { countModelMatches, modelSearchError, replaceAllInModel } from "./search";
import type { DocxModel, PptxModel, XlsxModel } from "./models";

describe("document model search replacement", () => {
  test("preserves DOCX runs around replaced text", () => {
    const model: DocxModel = {
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          text: "Alpha Beta",
          runs: [
            { text: "Alpha ", bold: true },
            { text: "Beta", italic: true },
          ],
        },
      ],
    };

    const result = replaceAllInModel(model, {
      query: "pha",
      replacement: "PHA",
    });

    expect(result.replacements).toBe(1);
    expect((result.model as DocxModel).blocks[0].runs).toEqual([
      { text: "AlPHA ", bold: true },
      { text: "Beta", italic: true },
    ]);
  });

  test("supports regex capture substitution and Unicode-aware whole words", () => {
    expect(
      replaceAllInModel(
        { content: "alpha-beta" },
        { query: "(alpha)-(beta)", replacement: "$2/$1", regexSearch: true },
      ),
    ).toEqual({ model: { content: "beta/alpha" }, replacements: 1 });
    expect(
      replaceAllInModel(
        { content: "한글 한" },
        { query: "한", replacement: "K", wholeWord: true },
      ),
    ).toEqual({ model: { content: "한글 K" }, replacements: 1 });
    expect(modelSearchError({ query: "(", regexSearch: true })).toBe(
      "Invalid regular expression",
    );
  });

  test("does not bypass preservation-only rich text or formula scopes", () => {
    const docx: DocxModel = {
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          text: "protected",
          fields: [{ id: "f1", instruction: "DATE" }],
        },
      ],
    };
    const pptx: PptxModel = {
      slides: [
        {
          id: "s1",
          name: "Slide 1",
          texts: [{ id: "t1", text: "protected", complexText: true }],
        },
      ],
    };
    const xlsx: XlsxModel = {
      sheets: [
        {
          id: "s1",
          name: "Sheet1",
          rows: [
            {
              index: "1",
              cells: [
                { ref: "A1", value: "", formula: "protected" },
                { ref: "B1", value: "protected" },
              ],
            },
          ],
        },
      ],
    };

    expect(countModelMatches(docx, { query: "protected" })).toBe(0);
    expect(countModelMatches(pptx, { query: "protected" })).toBe(0);
    expect(countModelMatches(xlsx, { query: "protected" })).toBe(1);
  });
});
