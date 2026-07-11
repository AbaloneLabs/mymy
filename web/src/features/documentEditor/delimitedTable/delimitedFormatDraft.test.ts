import { describe, expect, test } from "vitest";
import {
  changedDelimitedFormatKeys,
  delimitedEncodingIssue,
  delimitedFormatDraft,
  delimitedFormatSample,
} from "./delimitedFormatDraft";

describe("delimited format draft", () => {
  test("supports exact format cancellation without touching rows", () => {
    const baseline = delimitedFormatDraft({
      rows: [["한글", "a,b"]],
      delimiter: ",",
      encoding: "utf-8",
    });
    const draft = { ...baseline, delimiter: "\t", encoding: "windows-1252" };
    expect(changedDelimitedFormatKeys(baseline, draft)).toEqual([
      "encoding",
      "delimiter",
    ]);
    expect(delimitedEncodingIssue([["한글"]], draft.encoding)).toContain("cannot encode");
    expect(changedDelimitedFormatKeys(baseline, { ...baseline })).toEqual([]);
  });

  test("previews quoting with embedded delimiters", () => {
    expect(
      delimitedFormatSample([["a,b", 'x"y']], {
        delimiter: ",",
        quoteCharacter: '"',
        escapePolicy: "double",
        quoteStyle: "minimal",
      }),
    ).toBe('"a,b","x""y"');
  });

  test("requires self-identifying BOM combinations", () => {
    expect(delimitedEncodingIssue([["alpha"]], "utf-16le", false)).toContain(
      "requires a BOM",
    );
    expect(delimitedEncodingIssue([["alpha"]], "windows-1252", true)).toContain(
      "does not support a BOM",
    );
  });
});
