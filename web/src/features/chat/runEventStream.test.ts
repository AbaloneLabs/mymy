import { describe, expect, it } from "vitest";
import { parseSseFrame } from "./runEventStream";

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
});
