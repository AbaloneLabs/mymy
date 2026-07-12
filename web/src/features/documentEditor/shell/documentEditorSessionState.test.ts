import { describe, expect, it } from "vitest";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";
import {
  createDocumentEditorSessionState,
  documentEditorSessionReducer,
} from "./documentEditorSessionState";

describe("document editor session state", () => {
  it("composes A and B and can cancel B back to exactly A", () => {
    let state = createDocumentEditorSessionState(response("server", { value: "base" }));
    state = documentEditorSessionReducer(state, {
      type: "localDraft",
      model: { value: "A" },
      key: "local:A",
    });
    const afterA = state.currentModel;
    state = documentEditorSessionReducer(state, {
      type: "localDraft",
      model: { value: "A+B" },
      key: "local:B",
    });
    state = documentEditorSessionReducer(state, {
      type: "localDraft",
      model: afterA,
      key: "local:A",
    });
    expect(state.currentModel).toEqual({ value: "A" });
    expect(state.serverModel).toEqual({ value: "base" });
  });

  it("does not clear B when the acknowledgement covers only A", () => {
    let state = createDocumentEditorSessionState(response("server", { value: "base" }));
    state = documentEditorSessionReducer(state, {
      type: "localDraft",
      model: { value: "A" },
      key: "local:A",
    });
    state = documentEditorSessionReducer(state, {
      type: "saveStarted",
      snapshotKey: "local:A",
      expectedFingerprint: "server",
    });
    state = documentEditorSessionReducer(state, {
      type: "localDraft",
      model: { value: "A+B" },
      key: "local:B",
    });
    state = documentEditorSessionReducer(state, {
      type: "saveSucceeded",
      snapshotKey: "local:A",
      response: response("saved-A", { value: "A" }),
    });
    expect(state.serverModel).toEqual({ value: "A" });
    expect(state.currentModel).toEqual({ value: "A+B" });
    expect(state.currentKey).toBe("local:B");
    expect(state.currentKey).not.toBe(state.serverKey);
  });

  it("pins a remote revision while dirty and adopts it when clean", () => {
    const incoming = response("remote", { value: "remote" });
    let dirty = createDocumentEditorSessionState(response("server", { value: "base" }));
    dirty = documentEditorSessionReducer(dirty, {
      type: "localDraft",
      model: { value: "local" },
      key: "local:A",
    });
    dirty = documentEditorSessionReducer(dirty, {
      type: "incomingRevision",
      response: incoming,
      source: "another-tab",
    });
    expect(dirty.currentModel).toEqual({ value: "local" });
    expect(dirty.externalRevision?.fingerprint).toBe("remote");

    const clean = documentEditorSessionReducer(
      createDocumentEditorSessionState(response("server", { value: "base" })),
      { type: "incomingRevision", response: incoming, source: "external" },
    );
    expect(clean.currentModel).toEqual({ value: "remote" });
    expect(clean.externalRevision).toBeNull();
  });
});

function response(fingerprint: string, model: unknown): DocumentEditorModelResponse {
  return {
    path: "/drive/document.txt",
    name: "document.txt",
    editorKind: "text",
    mimeType: "text/plain",
    fingerprint,
    modelSchemaVersion: 1,
    capabilities: [],
    capabilityRevision: "document-capability-matrix-v1",
    editingMode: "editable",
    lifecycleState: "active",
    syncStatus: "localOnly",
    compatibilityWarnings: [],
    model,
  };
}
