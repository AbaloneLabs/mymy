import { describe, expect, it } from "vitest";
import { documentEditorLifecycleStatus } from "./documentEditorLifecycle";

const clean = {
  loaded: true,
  readOnly: false,
  lifecycleBlocked: false,
  conflict: false,
  recoveryAvailable: false,
  saving: false,
  reconciling: false,
  dirty: false,
};

describe("document editor lifecycle", () => {
  it("reports clean and dirty without contradictory persistence labels", () => {
    expect(documentEditorLifecycleStatus(clean)).toBe("clean");
    expect(documentEditorLifecycleStatus({ ...clean, dirty: true })).toBe("dirty");
  });

  it("keeps conflict and lifecycle denial stronger than saving", () => {
    expect(
      documentEditorLifecycleStatus({ ...clean, dirty: true, saving: true, conflict: true }),
    ).toBe("conflict");
    expect(
      documentEditorLifecycleStatus({
        ...clean,
        lifecycleBlocked: true,
        conflict: true,
        saving: true,
      }),
    ).toBe("lifecycle_blocked");
  });

  it("makes recovery explicit before ordinary dirty state", () => {
    expect(
      documentEditorLifecycleStatus({ ...clean, dirty: true, recoveryAvailable: true }),
    ).toBe("recovery_available");
  });
});
