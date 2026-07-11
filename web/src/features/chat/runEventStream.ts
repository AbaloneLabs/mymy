import { API_BASE, apiErrorFromResponse } from "@/lib/api";
import type { AgentRunStatus, ChatSseEvent } from "./api";

/** Read one durable SSE response and return the greatest observed sequence. */
export async function readRunEvents(
  runId: string,
  afterSequence: number,
  onEvent: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
) {
  const path = `/agent-runs/${runId}/events?afterSequence=${afterSequence}`;
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw await apiErrorFromResponse(response, path);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("run event stream body is not readable");
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = afterSequence;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;
      cursor = Math.max(cursor, parsed.sequence);
      onEvent(parsed.event);
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseFrame(buffer);
    if (parsed) {
      cursor = Math.max(cursor, parsed.sequence);
      onEvent(parsed.event);
    }
  }
  return cursor;
}

export function parseSseFrame(
  frame: string,
): { sequence: number; event: ChatSseEvent } | null {
  const lines = frame.split(/\r?\n/);
  const idLine = lines.find((line) => line.startsWith("id:"));
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const sequence = Number(idLine?.slice(3).trim() ?? 0);
  return {
    sequence: Number.isFinite(sequence) ? sequence : 0,
    event: JSON.parse(dataLines.join("\n")) as ChatSseEvent,
  };
}

export function abortableRunDelay(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, delay);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Run observation aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function isTerminalRun(status: AgentRunStatus) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
