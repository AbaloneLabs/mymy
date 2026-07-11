import { describe, expect, test } from "vitest";
import { parseDocumentEditorRevisionNotice } from "./documentEditorRevisionChannel";

describe("document editor revision channel", () => {
  test("accepts only content-free versioned revision notices", () => {
    expect(
      parseDocumentEditorRevisionNotice({
        version: 1,
        actor: "browser-tab",
        path: "/drive/shared/report.md",
        fingerprint: "next",
        sourceSessionId: "tab-a",
        savedAt: "2026-07-10T12:00:00.000Z",
      }),
    ).toMatchObject({ fingerprint: "next", sourceSessionId: "tab-a" });
    expect(parseDocumentEditorRevisionNotice({ version: 1, path: "/drive" })).toBeNull();
  });
});
