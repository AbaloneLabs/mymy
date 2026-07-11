import { describe, expect, test } from "vitest";
import {
  changedTextFileFormatKeys,
  textFileFormatDraft,
  textFileFormatImpact,
  textFileFormatIssue,
} from "./textFormatDraft";

describe("text file format draft", () => {
  test("keeps file format changes separate from the document model", () => {
    const baseline = textFileFormatDraft({
      content: "alpha\n",
      encoding: "utf-8",
      lineEnding: "\n",
    });
    const draft = { ...baseline, encoding: "utf-16le" as const, bom: true };
    expect(changedTextFileFormatKeys(baseline, draft)).toEqual([
      "encoding",
      "bom",
    ]);
  });

  test("rejects byte formats that cannot reopen or encode the source", () => {
    const baseline = textFileFormatDraft({ content: "" });
    expect(
      textFileFormatIssue("alpha", {
        ...baseline,
        encoding: "utf-16le",
        bom: false,
      }),
    ).toContain("requires a BOM");
    expect(
      textFileFormatIssue("한글", {
        ...baseline,
        encoding: "windows-1252",
      }),
    ).toContain("line 1, column 1");
  });

  test("previews line-ending and byte-size impact", () => {
    const impact = textFileFormatImpact("a\nb", {
      encoding: "utf-8",
      bom: true,
      lineEnding: "\r\n",
    });
    expect(impact.lineBreaks).toBe(1);
    expect(impact.estimatedBytes).toBe(7);
    expect(impact.sample).toBe("a␍␊\nb");
  });
});
