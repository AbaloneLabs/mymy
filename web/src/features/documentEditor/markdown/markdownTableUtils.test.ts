import { describe, expect, test } from "vitest";
import {
  markdownTables,
  patchMarkdownTableAlignment,
  patchMarkdownTableCell,
} from "./markdownTableUtils";

describe("Markdown table source spans", () => {
  test("patches one cell without normalizing pipes, spacing, or inline code", () => {
    const source = [
      "Name | Note | Code",
      "---|:---:|---:",
      " A  | one\\|two | `a|b`  ",
      "<!-- untouched -->",
    ].join("\n");
    const table = markdownTables(source)[0];
    expect(table.rows[0]).toEqual(["A", "one|two", "`a|b`"]);

    const changed = patchMarkdownTableCell(
      source,
      table.rowSpans[0][1],
      "changed|value",
    );
    expect(changed).toBe(
      [
        "Name | Note | Code",
        "---|:---:|---:",
        " A  | changed\\|value | `a|b`  ",
        "<!-- untouched -->",
      ].join("\n"),
    );
  });

  test("changes only the owned alignment marker", () => {
    const source = "| A | B |\n| --- | :---: |\n| 1 | 2 |";
    const table = markdownTables(source)[0];
    expect(
      patchMarkdownTableAlignment(source, table.alignmentSpans[1], "right"),
    ).toBe("| A | B |\n| --- | ---: |\n| 1 | 2 |");
  });
});
