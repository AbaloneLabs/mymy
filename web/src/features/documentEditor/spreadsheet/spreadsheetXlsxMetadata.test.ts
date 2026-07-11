import { describe, expect, test } from "vitest";

import {
  nonOverlappingComments,
  nonOverlappingConditionalFormattings,
  nonOverlappingDataValidations,
  nonOverlappingHyperlinks,
} from "./spreadsheetXlsxMetadata";

const centerCell = { top: 1, right: 1, bottom: 1, left: 1 };

describe("spreadsheet metadata range replacement", () => {
  test("subtracts only the edited cells from a larger validation range", () => {
    const [validation] = nonOverlappingDataValidations(
      [{ sqref: "A1:C3 E1:E2", type: "whole" }],
      centerCell,
    );

    expect(validation.sqref).toBe(
      "A1:C1 A3:C3 A2:A2 C2:C2 E1:E2",
    );
    expect(validation.type).toBe("whole");
  });

  test("preserves unrelated conditional formatting and opaque references", () => {
    const [formatting] = nonOverlappingConditionalFormattings(
      [{ sqref: "A1:C3 opaque-reference", rules: [{ type: "expression" }] }],
      centerCell,
    );

    expect(formatting.sqref).toBe(
      "A1:C1 A3:C3 A2:A2 C2:C2 opaque-reference",
    );
    expect(formatting.rules).toEqual([{ type: "expression" }]);
  });

  test("removes a fully selected hyperlink or comment but keeps neighbors", () => {
    expect(
      nonOverlappingHyperlinks(
        [
          { ref: "B2", target: "https://selected.invalid" },
          { ref: "C2", target: "https://kept.invalid" },
        ],
        centerCell,
      ),
    ).toEqual([{ ref: "C2:C2", target: "https://kept.invalid" }]);
    expect(
      nonOverlappingComments(
        [
          { ref: "B2", text: "selected" },
          { ref: "C2", text: "kept" },
        ],
        centerCell,
      ),
    ).toEqual([{ ref: "C2", text: "kept" }]);
  });
});
