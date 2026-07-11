import { describe, expect, test } from "vitest";
import {
  missingDocumentEditorCapabilities,
  requiredDocumentEditorCapabilities,
} from "./capabilities";

describe("document editor capability negotiation", () => {
  test("blocks a rolling deployment that lacks the model capability", () => {
    const required = requiredDocumentEditorCapabilities("docx");
    expect(missingDocumentEditorCapabilities("docx", required)).toEqual([]);
    expect(
      missingDocumentEditorCapabilities(
        "docx",
        required.filter((item) => item !== "docx-run-model-v1"),
      ),
    ).toEqual(["docx-run-model-v1"]);
  });
});
