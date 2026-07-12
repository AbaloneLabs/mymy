import { describe, expect, it } from "vitest";
import {
  removeUnavailableDecisionScopes,
  setDecisionProjectScope,
} from "@/features/decisions/urlState";

describe("Decision URL project scope", () => {
  it("binds an explicit project without dropping unrelated filters", () => {
    const params = new URLSearchParams("status=pending&kind=approval&scope=all");

    setDecisionProjectScope(params, "project-1");

    expect(params.toString()).toBe(
      "status=pending&kind=approval&scope=project&project=project-1",
    );
  });

  it("returns to all permitted without retaining a stale project", () => {
    const params = new URLSearchParams("scope=project&project=project-1&decisionId=d-1");

    setDecisionProjectScope(params, null);

    expect(params.toString()).toBe("scope=all&decisionId=d-1");
  });

  it("removes inaccessible scopes explicitly while preserving other filters", () => {
    const params = new URLSearchParams(
      "scope=project&project=deleted-project&agent=deleted-agent&kind=input",
    );

    const change = removeUnavailableDecisionScopes(
      params,
      new Set(["active-agent"]),
      new Set(["active-project"]),
    );

    expect(change).toEqual({ agentRemoved: true, projectRemoved: true });
    expect(params.toString()).toBe("scope=all&kind=input");
  });
});
