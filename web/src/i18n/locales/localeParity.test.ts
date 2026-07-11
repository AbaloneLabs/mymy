import { describe, expect, it } from "vitest";
import en from "./en";
import ja from "./ja";
import ko from "./ko";
import zh from "./zh";

function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? leafKeys(child, path)
      : [path];
  });
}

describe("locale resources", () => {
  it.each([
    ["ko", ko],
    ["ja", ja],
    ["zh", zh],
  ] as const)("keeps %s keys in parity with English", (_locale, resource) => {
    expect(leafKeys(resource).sort()).toEqual(leafKeys(en).sort());
  });
});
