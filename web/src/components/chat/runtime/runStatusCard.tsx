import { AlertTriangle, Loader2, Square } from "lucide-react";
import type { AgentRunStatus } from "@/features/chat/api";
import type { RunChecklistItem } from "@/features/chat/api";

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: "대기 중",
  running: "실행 중",
  waiting_decision: "사용자 결정 대기",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

export function RunStatusCard({
  runId,
  status,
  cancelling,
  outcomeUnknown = false,
  checklist,
  onStop,
}: {
  runId: string;
  status: AgentRunStatus;
  cancelling: boolean;
  outcomeUnknown?: boolean;
  checklist: RunChecklistItem[];
  onStop: () => void;
}) {
  const terminal =
    status === "completed" || status === "failed" || status === "cancelled";
  const label = cancelling && !terminal ? "취소 처리 중" : STATUS_LABELS[status];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text)]">
            {!terminal && (
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-[var(--accent)]"
                strokeWidth={1.75}
              />
            )}
            <span>{label}</span>
          </div>
          <p className="mt-1 truncate text-[10px] text-[var(--text-faint)]">
            Run {runId}
          </p>
        </div>
        {!terminal && (
          <button
            type="button"
            onClick={onStop}
            disabled={cancelling}
            className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-wait disabled:opacity-50"
          >
            <Square className="h-3 w-3" strokeWidth={1.75} />
            중지
          </button>
        )}
      </div>
      {outcomeUnknown && (
        <div className="mt-2 flex gap-2 text-xs text-[var(--status-warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>도구 부작용의 완료 여부를 확인한 뒤 다시 시도해야 합니다.</span>
        </div>
      )}
      {checklist.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
          {checklist.map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-xs">
              <span className="w-4 shrink-0 text-center text-[var(--text-faint)]">
                {item.status === "completed"
                  ? "✓"
                  : item.status === "in_progress"
                    ? "→"
                    : item.status === "blocked"
                      ? "!"
                      : item.status === "cancelled"
                        ? "−"
                        : "·"}
              </span>
              <span className={item.status === "completed" ? "text-[var(--text-faint)] line-through" : "text-[var(--text-muted)]"}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
