import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AuditLog } from "@/types/audit";
import {
  formatAuditTimestamp,
  formatAuditValue,
} from "./AuditLogFormatting";

export function AuditLogTimeline({
  logs,
  isLoading,
  isError,
}: {
  logs: AuditLog[];
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-[var(--text-faint)]">
        ...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center text-sm text-[var(--text-faint)]">
        {t("common.error")}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-[var(--text-faint)]">
        {t("settings.audit.empty")}
      </div>
    );
  }

  return (
    <ol className="relative space-y-0 border-l border-[var(--border)] pl-5">
      {logs.map((log) => (
        <TimelineItem key={log.id} log={log} />
      ))}
    </ol>
  );
}

function TimelineItem({ log }: { log: AuditLog }) {
  const { t } = useTranslation();

  const actionLabel =
    log.action === "create"
      ? t("settings.audit.created")
      : log.action === "update"
        ? t("settings.audit.updated")
        : log.action === "delete"
          ? t("settings.audit.deleted")
          : log.action === "deny"
            ? t("settings.audit.denied")
            : log.action === "redact"
              ? t("settings.audit.redacted")
              : log.action;

  return (
    <li className="relative pb-5">
      <span
        className={cn(
          "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface)]",
          log.action === "create"
            ? "bg-emerald-500"
            : log.action === "update"
              ? "bg-amber-500"
              : log.action === "delete"
                ? "bg-rose-500"
                : log.action === "deny"
                  ? "bg-red-500"
                  : log.action === "redact"
                    ? "bg-sky-500"
                    : "bg-[var(--text-faint)]",
        )}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-[var(--text)]">
          {actionLabel}
        </span>
        <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
          {log.entityType}
        </span>
        {log.entityId && (
          <span className="font-mono text-xs text-[var(--text-faint)]">
            #{log.entityId.slice(0, 8)}
          </span>
        )}
        <span className="text-xs text-[var(--text-faint)]">
          {formatAuditTimestamp(log.createdAt)}
        </span>
      </div>

      <div className="mt-1 text-xs text-[var(--text-muted)]">
        <span className="text-[var(--text-faint)]">{log.actorType}</span>{" "}
        <span className="font-mono">{log.actorId}</span>
      </div>

      {log.changes && Object.keys(log.changes).length > 0 && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5">
          <ChangeDetails changes={log.changes} />
        </div>
      )}
    </li>
  );
}

function ChangeDetails({ changes }: { changes: Record<string, unknown> }) {
  const { t } = useTranslation();

  const before = changes["before"];
  const after = changes["after"];

  if (before !== undefined || after !== undefined) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {before !== undefined && (
          <ChangeBlock label={t("settings.audit.before")} value={before} />
        )}
        {after !== undefined && (
          <ChangeBlock label={t("settings.audit.after")} value={after} />
        )}
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-muted)]">
      {JSON.stringify(changes, null, 2)}
    </pre>
  );
}

function ChangeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">
        {label}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-muted)]">
        {formatAuditValue(value)}
      </pre>
    </div>
  );
}
