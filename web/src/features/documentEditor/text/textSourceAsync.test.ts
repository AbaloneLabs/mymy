import { describe, expect, test } from "vitest";
import {
  startChunkedSearchCount,
  startChunkedSearchRange,
} from "./textSourceAsync";

describe("chunked source search", () => {
  test("counts zero-width matches without looping", async () => {
    const count = await new Promise<number>((resolve) => {
      startChunkedSearchCount({
        content: "aa",
        query: "(?=a)",
        caseSensitive: true,
        wholeWord: false,
        regexSearch: true,
        chunkSize: 1,
        onDone: resolve,
      });
    });
    expect(count).toBe(2);
  });

  test("returns a zero-width range safely", async () => {
    const range = await new Promise<{ start: number; end: number } | null>(
      (resolve) => {
        startChunkedSearchRange({
          content: "alpha",
          query: "(?=a)",
          caseSensitive: true,
          wholeWord: false,
          regexSearch: true,
          start: 0,
          chunkSize: 2,
          onDone: resolve,
        });
      },
    );
    expect(range).toEqual({ start: 0, end: 0 });
  });
});
