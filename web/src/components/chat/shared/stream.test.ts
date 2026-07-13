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
    // Text segment is the first timeline item.
    expect(state.timeline[0]).toEqual({ type: "text", content: "A" });
    // Tool segment is the second timeline item and is marked done.
    expect(state.timeline[1]).toMatchObject({
      type: "tool",
      event: { id: "call-1", status: "done", detail: "ok" },
    });
  });

  it("interleaves text and tool segments in arrival order", () => {
    // Simulate: text -> tool -> text -> tool within a single turn.
    let state = chatStreamReducer(initialChatStreamState, {
      type: "event",
      sessionId: "session-1",
      event: { type: "text_delta", content: "Let me check " },
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
        duration_ms: 1,
      },
    });
    state = chatStreamReducer(state, {
      type: "event",
      sessionId: "session-1",
      event: { type: "text_delta", content: "Now searching " },
    });
    state = chatStreamReducer(state, {
      type: "event",
      sessionId: "session-1",
      event: {
        type: "tool_call_start",
        call_id: "call-2",
        tool_name: "search_files",
        arguments: "{}",
      },
    });

    // The timeline must preserve the real interleaved order.
    expect(state.timeline).toHaveLength(4);
    expect(state.timeline[0]).toEqual({ type: "text", content: "Let me check " });
    expect(state.timeline[1]).toMatchObject({
      type: "tool",
      event: { id: "call-1", status: "done" },
    });
    expect(state.timeline[2]).toEqual({ type: "text", content: "Now searching " });
    expect(state.timeline[3]).toMatchObject({
      type: "tool",
      event: { id: "call-2", status: "running" },
    });
  });

  it("merges consecutive text deltas into the trailing text segment", () => {
    let state = chatStreamReducer(initialChatStreamState, {
      type: "event",
      sessionId: "session-1",
      event: { type: "text_delta", content: "Hello" },
    });
    state = chatStreamReducer(state, {
      type: "event",
      sessionId: "session-1",
      event: { type: "text_delta", content: " world" },
    });
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0]).toEqual({ type: "text", content: "Hello world" });
  });

  it("keeps provider failures out of the React error boundary", () => {
    expect(() =>
      chatStreamReducer(initialChatStreamState, {
        type: "event",
        sessionId: "session-1",
        event: { type: "error", message: "provider unavailable" },
      }),
    ).not.toThrow();
  });
});
