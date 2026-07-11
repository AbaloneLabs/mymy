import { describe, expect, test } from "vitest";
import type { DocumentEditorRecoveryDraft } from "./documentEditorRecoveryDraft";
import {
  documentEditorRecoveryDraftId,
  latestDocumentEditorRecoveryDraft,
} from "./documentEditorRecoveryDraft";

function recoveryDraft(
  sessionId: string,
  updatedAt: string,
): DocumentEditorRecoveryDraft {
  const path = "/drive/shared/report.md";
  return {
    id: documentEditorRecoveryDraftId(path, sessionId),
    sessionId,
    schemaVersion: 1,
    path,
    editorKind: "markdown",
    modelSchemaVersion: 1,
    baseFingerprint: "base",
    baseModel: { content: "base" },
    model: { content: sessionId },
    updatedAt,
  };
}

describe("document editor recovery draft ownership", () => {
  test("keeps same-path tab drafts under different identities", () => {
    expect(
      documentEditorRecoveryDraftId("/drive/shared/report.md", "tab-a"),
    ).not.toBe(
      documentEditorRecoveryDraftId("/drive/shared/report.md", "tab-b"),
    );
  });

  test("selects the latest non-ignored session without deleting another tab", () => {
    const older = recoveryDraft("tab-a", "2026-07-10T10:00:00.000Z");
    const newer = recoveryDraft("tab-b", "2026-07-10T11:00:00.000Z");

    expect(latestDocumentEditorRecoveryDraft([older, newer])?.id).toBe(newer.id);
    expect(
      latestDocumentEditorRecoveryDraft([older, newer], new Set([newer.id]))?.id,
    ).toBe(older.id);
  });
});
