import { describe, expect, it } from "vitest";
import { defaultDocumentCopyPath } from "./useDocumentEditorSession";

describe("document conflict copy path", () => {
  it("keeps the directory and extension while making ownership visible", () => {
    expect(defaultDocumentCopyPath("/drive/reports/Q2 review.docx")).toBe(
      "/drive/reports/Q2 review (conflict copy).docx",
    );
    expect(defaultDocumentCopyPath("/drive/notes/README")).toBe(
      "/drive/notes/README (conflict copy)",
    );
  });
});
