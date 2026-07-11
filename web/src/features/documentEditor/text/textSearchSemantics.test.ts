import { describe, expect, test } from "vitest";
import {
  advanceZeroWidthRegex,
  regexSearchError,
  replaceSearchMatches,
} from "./textSearchSemantics";

describe("cross-editor text replacement semantics", () => {
  test("keeps replacement tokens literal outside regex mode", () => {
    expect(replaceSearchMatches("one one", /one/g, "$&-$1", false)).toBe(
      "$&-$1 $&-$1",
    );
    expect(replaceSearchMatches("one", /(o)(ne)/g, "$2$1", true)).toBe("neo");
  });

  test("reports invalid regex and advances zero-width matches by code point", () => {
    expect(regexSearchError("(", true)).toBeTruthy();
    const regex = /(?=.)/gu;
    const content = "😀a";
    expect(regex.exec(content)?.index).toBe(0);
    expect(advanceZeroWidthRegex(regex, content)).toBe(true);
    expect(regex.lastIndex).toBe(2);
  });
});
