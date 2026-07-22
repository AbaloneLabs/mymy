/** Preserve unrelated chat filters while making the visible session durable. */
export function withChatSessionId(
  current: URLSearchParams,
  sessionId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (sessionId) {
    next.set("sessionId", sessionId);
  } else {
    next.delete("sessionId");
  }
  return next;
}
