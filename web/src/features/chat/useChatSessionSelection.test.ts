import { describe, expect, it } from "vitest";
import { resolveEffectiveChatSessionId } from "./useChatSessionSelection";

const sessions = [{ id: "newest" }, { id: "current" }];

describe("chat session selection", () => {
  it("restores the URL session before falling back to the newest session", () => {
    expect(resolveEffectiveChatSessionId(sessions, "current", null)).toBe("current");
    expect(resolveEffectiveChatSessionId(sessions, "current", "newest")).toBe(
      "current",
    );
  });

  it("falls back only when the requested session is no longer visible", () => {
    expect(resolveEffectiveChatSessionId(sessions, "deleted", "current")).toBe(
      "current",
    );
    expect(resolveEffectiveChatSessionId(sessions, "deleted", null)).toBe("newest");
  });
});
