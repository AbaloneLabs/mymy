import { cn } from "@/lib/utils";

export function SandboxRuntimePanel({
  runtime,
}: {
  runtime?: { mode: string; ready: boolean; dataRoot?: string; error?: string };
}) {
  return (
    <section className="grid gap-3 lg:grid-cols-4">
      <Metric
        label="상태"
        value={runtime?.ready ? "ready" : "unavailable"}
        tone={runtime?.ready ? "good" : "bad"}
      />
      <Metric label="모드" value={runtime?.mode ?? "unknown"} />
      <Metric label="데이터 루트" value={runtime?.dataRoot ?? "-"} />
      <Metric
        label="오류"
        value={runtime?.error ?? "-"}
        tone={runtime?.error ? "bad" : undefined}
      />
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-sm text-[var(--text)]",
          tone === "good" && "text-[var(--status-success)]",
          tone === "bad" && "text-[var(--status-error)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
