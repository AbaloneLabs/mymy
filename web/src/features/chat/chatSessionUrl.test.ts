import { describe, expect, it } from "vitest";
import { withChatSessionId } from "./chatSessionUrl";

describe("chat session URL", () => {
  it("persists the selected session without dropping other query state", () => {
    const next = withChatSessionId(
      new URLSearchParams("view=compact&sessionId=old"),
      "current",
    );

    expect(next.get("sessionId")).toBe("current");
    expect(next.get("view")).toBe("compact");
  });

  it("removes only the deleted session", () => {
    const next = withChatSessionId(
      new URLSearchParams("view=compact&sessionId=deleted"),
      null,
    );

    expect(next.has("sessionId")).toBe(false);
    expect(next.get("view")).toBe("compact");
  });
});
