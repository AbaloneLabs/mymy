import { describe, expect, test } from "vitest";
import { parseFlatConfig } from "./textFlatConfigParsers";
import {
  flatConfigEntryEditBlockReason,
  flatConfigStructuralEditBlockReason,
  patchLosslessFlatConfigScalar,
} from "./textFlatConfigCapability";

describe("flat config lossless capability", () => {
  test("keeps nested flow values and aliases source-only", () => {
    const yaml = parseFlatConfig(
      "anchor: &base value\nflow: [one, { nested: two }]\nalias: *base\n",
      "yaml",
    );
    expect(flatConfigEntryEditBlockReason(yaml.entries[0], "yaml")).toBeNull();
    expect(flatConfigEntryEditBlockReason(yaml.entries[1], "yaml")).toContain(
      "flow collections",
    );
    expect(flatConfigEntryEditBlockReason(yaml.entries[2], "yaml")).toContain(
      "aliases",
    );
    expect(
      flatConfigStructuralEditBlockReason({ ...yaml, kind: "yaml" }),
    ).toContain("preservation-only");
  });

  test("blocks structural edits when quoted keys are outside the parser", () => {
    const toml = parseFlatConfig('"quoted.key" = 1\nplain = 2\n', "toml");
    expect(
      flatConfigStructuralEditBlockReason({ ...toml, kind: "toml" }),
    ).toContain("outside the lossless grammar");
  });

  test("patches only the scalar span beside an anchor and comment", () => {
    const source = "anchor  :  &base value   # keep spacing\nother: true\n";
    const parsed = parseFlatConfig(source, "yaml");
    const next = patchLosslessFlatConfigScalar({
      content: source,
      entry: parsed.entries[0],
      key: "anchor",
      value: "changed",
      kind: "yaml",
    });
    expect(next).toBe(
      "anchor  :  &base changed   # keep spacing\nother: true\n",
    );
    const restored = patchLosslessFlatConfigScalar({
      content: next!,
      entry: parseFlatConfig(next!, "yaml").entries[0],
      key: "anchor",
      value: "value",
      kind: "yaml",
    });
    expect(restored).toBe(source);
  });

  test("blocks ambiguous structural ownership and typed TOML values", () => {
    const yaml = parseFlatConfig("# owned by which key?\na: 1\nb: 2\n", "yaml");
    expect(
      flatConfigStructuralEditBlockReason({
        ...yaml,
        content: "# owned by which key?\na: 1\nb: 2\n",
        kind: "yaml",
      }),
    ).toContain("trivia ownership");

    const toml = parseFlatConfig("when = 2026-07-10T12:00:00Z\n", "toml");
    expect(flatConfigEntryEditBlockReason(toml.entries[0], "toml")).toContain(
      "date/time",
    );
  });
});
