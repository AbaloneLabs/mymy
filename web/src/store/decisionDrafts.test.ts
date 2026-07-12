import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/store/auth";
import { useDecisionDrafts } from "@/store/decisionDrafts";

describe("decision draft lifecycle", () => {
  beforeEach(() => {
    useDecisionDrafts.getState().clearAll();
    useAuthStore.setState({ isAuthenticated: true });
  });

  it("binds a draft to the exact target revision", () => {
    useDecisionDrafts.getState().setDraft("decision-a", "revision-1", "answer");
    expect(useDecisionDrafts.getState().drafts["decision-a"]).toEqual({
      targetVersion: "revision-1",
      value: "answer",
    });
    useDecisionDrafts.getState().setDraft("decision-a", "revision-2", "new answer");
    expect(useDecisionDrafts.getState().drafts["decision-a"]).toEqual({
      targetVersion: "revision-2",
      value: "new answer",
    });
  });

  it("clears all private drafts when authentication is lost", () => {
    useDecisionDrafts.getState().setDraft("decision-a", "revision-1", "answer");
    useAuthStore.getState().setAuthState(false);
    expect(useDecisionDrafts.getState().drafts).toEqual({});
  });
});
