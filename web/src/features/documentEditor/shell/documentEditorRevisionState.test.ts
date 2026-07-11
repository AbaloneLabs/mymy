import { describe, expect, it } from "vitest";
import {
  classifyIncomingDocumentRevision,
  reviewedConflictFingerprint,
} from "./documentEditorRevisionState";

describe("document editor revision state", () => {
  it("adopts a new server revision only while the local session is clean", () => {
    expect(
      classifyIncomingDocumentRevision({
        acceptedFingerprint: "r1",
        incomingFingerprint: "r2",
        dirty: false,
        saving: false,
      }),
    ).toBe("adopt");
  });

  it("pins dirty and in-flight drafts when a refetch observes another revision", () => {
    expect(
      classifyIncomingDocumentRevision({
        acceptedFingerprint: "r1",
        incomingFingerprint: "r2",
        dirty: true,
        saving: false,
      }),
    ).toBe("pin-external");
    expect(
      classifyIncomingDocumentRevision({
        acceptedFingerprint: "r1",
        incomingFingerprint: "r2",
        dirty: false,
        saving: true,
      }),
    ).toBe("pin-external");
  });

  it("does not create an external revision for the accepted fingerprint", () => {
    expect(
      classifyIncomingDocumentRevision({
        acceptedFingerprint: "r1",
        incomingFingerprint: "r1",
        dirty: true,
        saving: false,
      }),
    ).toBe("same");
  });

  it("requires an explicit newer reviewed fingerprint for overwrite", () => {
    expect(
      reviewedConflictFingerprint({
        acceptedFingerprint: "r1",
        reviewedFingerprint: null,
      }),
    ).toBeNull();
    expect(
      reviewedConflictFingerprint({
        acceptedFingerprint: "r1",
        reviewedFingerprint: "r1",
      }),
    ).toBeNull();
    expect(
      reviewedConflictFingerprint({
        acceptedFingerprint: "r1",
        reviewedFingerprint: "r2",
      }),
    ).toBe("r2");
  });
});
