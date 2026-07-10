import { describe, expect, it } from "vitest";
import type { DocxBlock, DocxStyle } from "../shared/models";
import { docxRunTextInputPatch, resolveDocxStyle } from "./docxTextRuns";

const baseBlock: DocxBlock = {
  id: "p1",
  type: "paragraph",
  text: "AlphaBeta",
  runs: [
    { text: "Alpha", bold: true, fontFamily: "Noto Sans" },
    { text: "Beta", italic: true, fontFamily: "Noto Serif" },
  ],
};

describe("DOCX text runs", () => {
  it("inserts typed text with the surrounding run style", () => {
    const next = docxRunTextInputPatch(baseBlock, 5, 5, " ");

    expect(next?.text).toBe("Alpha Beta");
    expect(next?.runs).toEqual([
      { text: "Alpha ", bold: true, fontFamily: "Noto Sans" },
      { text: "Beta", italic: true, fontFamily: "Noto Serif" },
    ]);
  });

  it("replaces a selected range without losing adjacent run formatting", () => {
    const next = docxRunTextInputPatch(baseBlock, 2, 7, "Z");

    expect(next?.text).toBe("AlZta");
    expect(next?.runs).toEqual([
      { text: "AlZ", bold: true, fontFamily: "Noto Sans" },
      { text: "ta", italic: true, fontFamily: "Noto Serif" },
    ]);
  });

  it("deletes a selected range and merges compatible neighboring runs", () => {
    const block: DocxBlock = {
      id: "p1",
      type: "paragraph",
      text: "AlphaBetaGamma",
      runs: [
        { text: "Alpha", bold: true },
        { text: "Beta", italic: true },
        { text: "Gamma", bold: true },
      ],
    };

    const next = docxRunTextInputPatch(block, 5, 9, "");

    expect(next?.text).toBe("AlphaGamma");
    expect(next?.runs).toEqual([{ text: "AlphaGamma", bold: true }]);
  });

  it("resolves paragraph style inheritance while allowing child overrides", () => {
    const styles: DocxStyle[] = [
      {
        id: "Base",
        name: "Base",
        fontFamily: "Noto Serif",
        fontSize: "12",
        color: "#111111",
        bold: true,
      },
      {
        id: "Quote",
        name: "Quote",
        basedOn: "Base",
        italic: true,
        color: "#444444",
      },
    ];

    expect(resolveDocxStyle(styles, "Quote")).toMatchObject({
      id: "Quote",
      name: "Quote",
      fontFamily: "Noto Serif",
      fontSize: "12",
      color: "#444444",
      bold: true,
      italic: true,
    });
  });

  it("leaves cyclic style inheritance finite", () => {
    const styles: DocxStyle[] = [
      { id: "A", name: "A", basedOn: "B", bold: true },
      { id: "B", name: "B", basedOn: "A", italic: true },
    ];

    expect(resolveDocxStyle(styles, "A")).toMatchObject({
      id: "A",
      name: "A",
      bold: true,
    });
  });
});
