import { describe, expect, it } from "vitest";
import { chatStreamReducer, initialChatStreamState } from "./stream";

describe("chat stream reducer", () => {
  it("projects ordered deltas and tool completion without transport state", () => {
    let state = chatStreamReducer(initialChatStreamState, {
      type: "event",
      sessionId: "session-1",
      event: { type: "text_delta", content: "A" },
    });
    state = chatStreamReducer(state, {
      type: "event",
      sessionId: "session-1",
      event: {
        type: "tool_call_start",
        call_id: "call-1",
        tool_name: "read_file",
        arguments: "{}",
      },
    });
    state = chatStreamReducer(state, {
      type: "event",
      sessionId: "session-1",
      event: {
        type: "tool_call_finish",
        call_id: "call-1",
        result: "ok",
        duration_ms: 3,
      },
    });
    expect(state.assistantText).toBe("A");
    expect(state.toolEvents[0]).toMatchObject({
      id: "call-1",
      status: "done",
      detail: "ok",
    });
  });
});
