import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { observeAgentRun, type ChatSseEvent } from "@/features/chat/api";

export interface DelegateTaskResult {
  run_id?: string;
  index: number;
  goal: string;
  status: string;
  result?: string;
  error?: string | null;
  allowed_tools?: string[];
}

export interface DelegateResult {
  success: boolean;
  results: DelegateTaskResult[];
}

export function DelegateResultPanel({ result }: { result: DelegateResult }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [events, setEvents] = useState<Map<number, ChatSseEvent[]>>(new Map());
  const [loading, setLoading] = useState<Set<number>>(new Set());

  async function toggle(task: DelegateTaskResult) {
    if (expanded.has(task.index)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(task.index);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(task.index));
    if (!task.run_id || events.has(task.index)) return;
    setLoading((current) => new Set(current).add(task.index));
    const collected: ChatSseEvent[] = [];
    try {
      await observeAgentRun(task.run_id, 0, (event) => collected.push(event));
      setEvents((current) => new Map(current).set(task.index, collected));
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(task.index);
        return next;
      });
    }
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="mb-2 text-xs font-medium text-[var(--text)]">
        위임 작업 {result.results.length}개
      </p>
      <div className="space-y-1.5">
        {result.results.map((task) => {
          const isExpanded = expanded.has(task.index);
          const childEvents = events.get(task.index) ?? [];
          return (
            <div key={`${task.run_id ?? "delegate"}-${task.index}`} className="rounded border border-[var(--border)]">
              <button
                type="button"
                onClick={() => void toggle(task)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]">
                  {task.goal}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">{task.status}</span>
              </button>
              {isExpanded && (
                <div className="border-t border-[var(--border)] px-2 py-2 text-xs text-[var(--text-muted)]">
                  {loading.has(task.index) && (
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      실행 기록 불러오는 중
                    </div>
                  )}
                  {task.result && <p className="whitespace-pre-wrap break-words">{task.result}</p>}
                  {task.error && <p className="mt-1 text-[var(--status-error)]">{task.error}</p>}
                  {childEvents
                    .filter(
                      (event) =>
                        event.type === "tool_call_start" || event.type === "tool_call_finish",
                    )
                    .map((event, index) => (
                      <p key={`${task.index}-event-${index}`} className="mt-1 font-mono text-[10px]">
                        {event.type === "tool_call_start"
                          ? `→ ${event.tool_name}`
                          : event.error
                            ? `× ${event.error}`
                            : "✓ tool completed"}
                      </p>
                    ))}
                  {task.run_id && (
                    <p className="mt-2 truncate font-mono text-[9px] text-[var(--text-faint)]">
                      Run {task.run_id}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
