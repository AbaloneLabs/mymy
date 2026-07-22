import { API_BASE, apiErrorFromResponse } from "@/lib/api";
import type { AgentRunStatus, ChatSseEvent } from "./api";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: JsonRecord, key: string) {
  return typeof value[key] === "string";
}

function hasNumber(value: JsonRecord, key: string) {
  return typeof value[key] === "number" && Number.isFinite(value[key]);
}

function hasBoolean(value: JsonRecord, key: string) {
  return typeof value[key] === "boolean";
}

function hasOptionalString(value: JsonRecord, key: string) {
  return value[key] === undefined || value[key] === null || hasString(value, key);
}

function isChatMessage(value: unknown) {
  if (!isRecord(value)) return false;
  const validToolCalls =
    value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) &&
      value.toolCalls.every(
        (call) =>
          isRecord(call) &&
          hasString(call, "id") &&
          hasString(call, "name") &&
          hasString(call, "arguments"),
      ));
  return (
    hasString(value, "id") &&
    hasString(value, "sessionId") &&
    ["user", "assistant", "tool", "system"].includes(String(value.role)) &&
    hasString(value, "content") &&
    hasString(value, "createdAt") &&
    validToolCalls &&
    hasOptionalString(value, "toolCallId")
  );
}

function isChatSession(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    hasString(value, "agentId") &&
    hasString(value, "profile") &&
    ["active", "archived"].includes(String(value.status)) &&
    hasNumber(value, "messageCount") &&
    hasString(value, "createdAt") &&
    hasString(value, "updatedAt")
  );
}

function isClarifyRequest(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "requestId") &&
    hasString(value, "sessionId") &&
    hasString(value, "question") &&
    Array.isArray(value.choices) &&
    value.choices.every((choice) => typeof choice === "string") &&
    hasString(value, "createdAt")
  );
}

function isChecklistItem(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    hasString(value, "content") &&
    ["pending", "in_progress", "blocked", "completed", "cancelled"].includes(
      String(value.status),
    ) &&
    hasNumber(value, "position")
  );
}

function isToolCapability(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  return (
    [
      "effect",
      "risk",
      "idempotency",
      "parallelPolicy",
      "resourceKind",
      "dataSensitivity",
      "cancellation",
    ].every((key) => hasString(value, key)) &&
    ["cooperative", "process_group", "non_interruptible"].includes(
      String(value.cancellation),
    )
  );
}

/**
 * Decode the durable user event projection at the browser boundary.
 *
 * Backend-only audit events and payloads from a newer deployment are skipped
 * instead of entering React state. The SSE cursor still advances for skipped
 * frames, preventing an unsupported event from being replayed forever.
 */
export function decodeChatSseEvent(value: unknown): ChatSseEvent | null {
  if (!isRecord(value) || !hasString(value, "type")) return null;
  switch (value.type) {
    case "run_status":
      if (
        !hasString(value, "run_id") ||
        !["queued", "running", "waiting_decision", "completed", "failed", "cancelled"].includes(
          String(value.status),
        ) ||
        !hasBoolean(value, "cancel_requested")
      ) {
        return null;
      }
      break;
    case "outcome_unknown":
      if (!hasString(value, "run_id") || !hasString(value, "message")) return null;
      break;
    case "user_message":
      if (!isChatMessage(value.message)) return null;
      break;
    case "text_delta":
      if (!hasString(value, "content")) return null;
      break;
    case "model_turn_started":
      if (!hasNumber(value, "iteration")) return null;
      break;
    case "checklist_changed":
      if (!Array.isArray(value.items) || !value.items.every(isChecklistItem)) return null;
      break;
    case "checkpoint_created":
      if (!hasString(value, "checkpoint_id") || !hasNumber(value, "sequence")) return null;
      break;
    case "decision_created":
      if (
        !hasString(value, "decision_id") ||
        !hasString(value, "kind") ||
        !hasString(value, "question") ||
        !Array.isArray(value.choices) ||
        !hasBoolean(value, "blocking")
      ) {
        return null;
      }
      break;
    case "decision_resolved":
      if (!hasString(value, "decision_id") || !hasString(value, "kind")) return null;
      break;
    case "tool_call_start":
      if (
        !hasString(value, "call_id") ||
        !hasString(value, "tool_name") ||
        !hasString(value, "arguments") ||
        !hasOptionalString(value, "resource_key") ||
        !isToolCapability(value.capability)
      ) {
        return null;
      }
      break;
    case "tool_call_finish":
      if (
        !hasString(value, "call_id") ||
        !hasString(value, "result") ||
        !hasOptionalString(value, "error") ||
        !hasNumber(value, "duration_ms")
      ) {
        return null;
      }
      break;
    case "clarify":
      if (!isClarifyRequest(value.request)) return null;
      break;
    case "turn_completed":
      if (!hasString(value, "finish_reason") || value.usage === undefined) return null;
      break;
    case "context_compressing":
      break;
    case "provider_retry_scheduled":
      if (
        !hasString(value, "run_id") ||
        !hasString(value, "retry_at") ||
        !hasNumber(value, "retry_count") ||
        !hasString(value, "message")
      ) {
        return null;
      }
      break;
    case "provider_retry_requested":
      if (!hasString(value, "run_id")) return null;
      break;
    case "done":
      if (
        (value.assistant_message !== undefined &&
          value.assistant_message !== null &&
          !isChatMessage(value.assistant_message)) ||
        !isChatSession(value.session) ||
        !hasNumber(value, "total_api_calls") ||
        !hasNumber(value, "total_tool_calls")
      ) {
        return null;
      }
      break;
    case "error":
      if (!hasString(value, "message")) return null;
      break;
    default:
      return null;
  }
  return value as ChatSseEvent;
}

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
      if (parsed.event) onEvent(parsed.event);
      else console.warn("Skipped unsupported run event payload", { sequence: parsed.sequence });
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseFrame(buffer);
    if (parsed) {
      cursor = Math.max(cursor, parsed.sequence);
      if (parsed.event) onEvent(parsed.event);
      else console.warn("Skipped unsupported run event payload", { sequence: parsed.sequence });
    }
  }
  return cursor;
}

export function parseSseFrame(
  frame: string,
): { sequence: number; event: ChatSseEvent | null } | null {
  const lines = frame.split(/\r?\n/);
  const idLine = lines.find((line) => line.startsWith("id:"));
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const sequence = Number(idLine?.slice(3).trim() ?? 0);
  try {
    return {
      sequence: Number.isFinite(sequence) ? sequence : 0,
      event: decodeChatSseEvent(JSON.parse(dataLines.join("\n"))),
    };
  } catch {
    return {
      sequence: Number.isFinite(sequence) ? sequence : 0,
      event: null,
    };
  }
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
