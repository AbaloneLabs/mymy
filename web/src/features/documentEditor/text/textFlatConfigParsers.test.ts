import { describe, expect, it } from "vitest";
import {
  appendFlatConfigEntry,
  deleteFlatConfigGroup,
  parseFlatConfig,
} from "./textStructuredUtils";

describe("flat config parsing", () => {
  it("keeps YAML document indexes, decorators, and inline sequence paths", () => {
    const parsed = parseFlatConfig(
      [
        "---",
        "title: !custom &main Draft",
        "items:",
        "  - key: first",
        "---",
        "title: Second",
      ].join("\n"),
      "yaml",
    );

    expect(parsed.documentCount).toBe(2);
    expect(parsed.entries).toMatchObject([
      {
        documentIndex: 0,
        key: "title",
        value: "Draft",
        yamlDecorators: ["!custom", "&main"],
        valuePrefix: "!custom &main ",
        path: ["title"],
      },
      {
        documentIndex: 0,
        key: "key",
        value: "first",
        sequencePrefix: "- ",
        path: ["items", "[0]", "key"],
      },
      {
        documentIndex: 1,
        key: "title",
        value: "Second",
        path: ["title"],
      },
    ]);
  });

  it("targets TOML array-table sections when appending and deleting", () => {
    const content = [
      "[[servers]]",
      'name = "alpha"',
      "",
      "[[servers]]",
      'name = "beta"',
    ].join("\n");

    const parsed = parseFlatConfig(content, "toml");
    expect(parsed.entries.map((entry) => entry.path.join("."))).toEqual([
      "servers.[0].name",
      "servers.[1].name",
    ]);

    const appended = appendFlatConfigEntry(content, {
      kind: "toml",
      section: "servers.[0]",
      key: "port",
      value: "8080",
    });
    expect(appended).toContain('name = "alpha"\nport = 8080');
    expect(appended).toContain('[[servers]]\nname = "beta"');

    const deleted = deleteFlatConfigGroup(appended, "toml", ["servers", "[1]"]);
    expect(deleted).toContain("port = 8080");
    expect(deleted).not.toContain('"beta"');
  });
});
