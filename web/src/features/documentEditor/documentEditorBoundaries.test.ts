import { describe, expect, test } from "vitest";

const formatSources = import.meta.glob(
  [
    "./editors/**/*.{ts,tsx}",
    "./word/**/*.{ts,tsx}",
    "./spreadsheet/**/*.{ts,tsx}",
    "./presentation/**/*.{ts,tsx}",
    "./markdown/**/*.{ts,tsx}",
    "./text/**/*.{ts,tsx}",
    "./delimitedTable/**/*.{ts,tsx}",
    "!./**/*.test.{ts,tsx}",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/**
 * Persistence belongs to the shell controller. Format controllers may load
 * read-only assets, but they must communicate model changes exclusively via
 * `onChange`; otherwise a format-specific save can race the shared revision
 * and recovery coordinators.
 */
describe("document editor architecture boundaries", () => {
  test("keeps transport mutations outside format controllers and views", () => {
    const violations = Object.entries(formatSources).flatMap(([path, source]) => {
        return [
          /documentEditor\/shared\/api/.test(source) ? `${path}: editor API` : null,
          /\bapi\.(post|put|delete|form)\s*</.test(source)
            ? `${path}: transport mutation`
            : null,
          /\bfetch\s*\(/.test(source) ? `${path}: raw fetch` : null,
        ].filter((value): value is string => value !== null);
      });
    expect(violations).toEqual([]);
  });
});
