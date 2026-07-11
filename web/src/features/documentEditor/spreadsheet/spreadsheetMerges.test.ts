import { describe, expect, test } from "vitest";

import {
  xlsxMergeAwareSelectionTarget,
  xlsxMergeFragmentForCell,
} from "./spreadsheetMerges";

const merge = { top: 1, right: 3, bottom: 4, left: 1 };

describe("spreadsheet merged-cell interaction", () => {
  test("creates a clipped viewport fragment that still targets the real anchor", () => {
    const fragment = xlsxMergeFragmentForCell(
      merge,
      [3, 4, 5],
      [2, 3, 4],
      3,
      2,
    );

    expect(fragment).toMatchObject({
      anchor: { row: 1, column: 1 },
      rowSpan: 2,
      colSpan: 2,
      isFragmentAnchor: true,
    });
    expect(
      xlsxMergeFragmentForCell(merge, [3, 4, 5], [2, 3, 4], 4, 3)
        ?.isFragmentAnchor,
    ).toBe(false);
  });

  test("selects the complete merge and extends through its far edge", () => {
    expect(
      xlsxMergeAwareSelectionTarget([merge], { row: 3, column: 2 }, null, false),
    ).toEqual({
      active: { row: 1, column: 1 },
      anchor: { row: 1, column: 1 },
      end: { row: 4, column: 3 },
    });
    expect(
      xlsxMergeAwareSelectionTarget(
        [merge],
        { row: 3, column: 2 },
        { row: 0, column: 0 },
        true,
      ).end,
    ).toEqual({ row: 4, column: 3 });
  });
});
