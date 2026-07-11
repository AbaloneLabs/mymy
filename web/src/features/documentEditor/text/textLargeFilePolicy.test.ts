import { describe, expect, test } from "vitest";
import {
  LARGE_TEXT_EDITABLE_CHAR_LIMIT,
  LARGE_TEXT_FILE_CHAR_LIMIT,
  largeTextFilePolicy,
} from "./textLargeFilePolicy";

describe("large text file policy", () => {
  test("uses normal, transactional, and read-only modes at explicit limits", () => {
    expect(largeTextFilePolicy(LARGE_TEXT_FILE_CHAR_LIMIT, 10).mode).toBe(
      "normal",
    );
    expect(largeTextFilePolicy(LARGE_TEXT_FILE_CHAR_LIMIT + 1, 10).mode).toBe(
      "window-edit",
    );
    expect(largeTextFilePolicy(LARGE_TEXT_EDITABLE_CHAR_LIMIT + 1, 10).mode).toBe(
      "read-only",
    );
  });
});
