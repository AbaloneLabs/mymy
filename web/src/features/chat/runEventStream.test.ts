import { describe, expect, it, vi } from "vitest";
import {
  decodeChatSseEvent,
  parseSseFrame,
  readRunEvents,
} from "./runEventStream";

describe("run event stream parser", () => {
  it("joins multiline data and preserves the durable sequence", () => {
    const parsed = parseSseFrame(
      'id: 17\nevent: message\ndata: {"type":"text_delta",\ndata: "content":"hello"}',
    );
    expect(parsed).toEqual({
      sequence: 17,
      event: { type: "text_delta", content: "hello" },
    });
  });

  it("ignores heartbeat frames without data", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
  });

  it("advances past unknown and malformed payloads without projecting them", () => {
    expect(
      parseSseFrame(
        'id: 18\nevent: write_safety_inspected\ndata: {"type":"write_safety_inspected","verdict":"allow"}',
      ),
    ).toEqual({ sequence: 18, event: null });
    expect(parseSseFrame('id: 19\ndata: {"type":')).toEqual({
      sequence: 19,
      event: null,
    });
  });

  it("accepts durable decision events and rejects incomplete known events", () => {
    expect(
      decodeChatSseEvent({
        type: "decision_created",
        decision_id: "decision-1",
        kind: "choice",
        question: "Continue?",
        choices: ["yes", "no"],
        blocking: false,
      }),
    ).toMatchObject({ type: "decision_created", blocking: false });
    expect(decodeChatSseEvent({ type: "user_message" })).toBeNull();
  });

  it("continues after an unsupported frame and returns its durable cursor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        [
          'id: 20\nevent: write_safety_inspected\ndata: {"type":"write_safety_inspected"}',
          'id: 21\nevent: text_delta\ndata: {"type":"text_delta","content":"done"}',
          "",
        ].join("\n\n"),
        { status: 200 },
      ),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const received: unknown[] = [];
    try {
      await expect(readRunEvents("run-1", 19, (event) => received.push(event))).resolves.toBe(
        21,
      );
      expect(received).toEqual([{ type: "text_delta", content: "done" }]);
      expect(warning).toHaveBeenCalledWith("Skipped unsupported run event payload", {
        sequence: 20,
      });
    } finally {
      fetchMock.mockRestore();
      warning.mockRestore();
    }
  });
});
