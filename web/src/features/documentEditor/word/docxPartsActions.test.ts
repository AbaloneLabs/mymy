import { describe, expect, test } from "vitest";

import { docxContentControlTextChange } from "./docxPartsActions";
import type { DocxBlock, DocxContentControl } from "../shared/models";

const control: DocxContentControl = {
  id: "control-1",
  kind: "text",
  text: "same",
};

describe("DOCX content-control text identity", () => {
  test("changes a unique occurrence while preserving surrounding run styles", () => {
    const block: DocxBlock = {
      id: "p1",
      type: "paragraph",
      text: "before same after",
      runs: [
        { text: "before ", bold: true },
        { text: "same", italic: true },
        { text: " after", bold: true },
      ],
    };

    const result = docxContentControlTextChange(block, control, "changed");

    expect(result).toMatchObject({
      block: {
        text: "before changed after",
        runs: [
          { text: "before ", bold: true },
          { text: "changed", italic: true },
          { text: " after", bold: true },
        ],
      },
    });
  });

  test("blocks duplicate visible text instead of editing the first match", () => {
    const block: DocxBlock = {
      id: "p1",
      type: "paragraph",
      text: "same then same",
    };

    expect(docxContentControlTextChange(block, control, "changed")).toEqual({
      reason:
        "The same visible text occurs more than once and the model has no range anchor",
    });
  });

  test("uses the durable source range when visible control text is duplicated", () => {
    const anchoredControl: DocxContentControl = {
      ...control,
      start: 10,
      end: 14,
    };
    const block: DocxBlock = {
      id: "p1",
      type: "paragraph",
      text: "same then same",
      contentControls: [anchoredControl],
    };

    expect(docxContentControlTextChange(block, anchoredControl, "changed")).toMatchObject({
      block: {
        text: "same then changed",
        contentControls: [{ start: 10, end: 17 }],
      },
    });
  });
});
