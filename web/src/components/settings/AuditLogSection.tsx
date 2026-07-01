import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuditLogAction, AuditLogActorType } from "@/types/audit";
import { useAuditLogs } from "@/features/audit/api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/**
 * Audit log section — timeline view of all changes made by users and agents.
 *
 * Features:
 *   - Filter chips: actor type (all/user/agent), entity type, action
 *   - Pagination
 *   - Timeline rendering with before/after change details
 */
export function AuditLogSection() {
  const { t } = useTranslation();

  const [actorType, setActorType] = useState<"" | AuditLogActorType>("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState<"" | AuditLogAction>("");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useAuditLogs({
    actorType: actorType || undefined,
    entityType: entityType || undefined,
    action: action || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Reset offset when filters change.
  function changeActor(v: "" | AuditLogActorType) {
    setActorType(v);
    setOffset(0);
  }
  function changeEntity(v: string) {
    setEntityType(v);
    setOffset(0);
  }
  function changeAction(v: "" | AuditLogAction) {
    setAction(v);
    setOffset(0);
  }
  function selectSecurityDenials() {
    setActorType("agent");
    setEntityType("filesystem_guard");
    setAction("deny");
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Actor type filter */}
        <FilterGroup>
          <FilterChip
            label={t("settings.audit.filterAll")}
            active={actorType === ""}
            onClick={() => changeActor("")}
          />
          <FilterChip
            label={t("settings.audit.filterUser")}
            active={actorType === "user"}
            onClick={() => changeActor("user")}
          />
          <FilterChip
            label={t("settings.audit.filterAgent")}
            active={actorType === "agent"}
            onClick={() => changeActor("agent")}
          />
        </FilterGroup>

        <FilterChip
          label={t("settings.audit.security")}
          active={
            actorType === "agent" &&
            entityType === "filesystem_guard" &&
            action === "deny"
          }
          onClick={selectSecurityDenials}
        />

        {/* Entity type filter */}
        <FilterSelect
          ariaLabel={t("settings.audit.entityType")}
          value={entityType}
          onChange={changeEntity}
          options={[
            { value: "", label: t("settings.audit.entityType") },
            { value: "note", label: "Note" },
            { value: "task", label: "Task" },
            { value: "project", label: "Project" },
            { value: "event", label: "Event" },
            { value: "transaction", label: "Transaction" },
            { value: "chat_session", label: "Chat Session" },
            { value: "chat_message", label: "Chat Message" },
            { value: "agent_instance", label: "Agent Instance" },
            { value: "agent_session", label: "Agent Session" },
            { value: "settings", label: "Settings" },
            { value: "pin", label: "PIN" },
            { value: "filesystem_guard", label: "Filesystem Guard" },
          ]}
        />

        {/* Action filter */}
        <FilterSelect
          ariaLabel={t("settings.audit.action")}
          value={action}
          onChange={(v) => changeAction(v as "" | AuditLogAction)}
          options={[
            { value: "", label: t("settings.audit.action") },
            { value: "create", label: t("settings.audit.created") },
            { value: "update", label: t("settings.audit.updated") },
            { value: "delete", label: t("settings.audit.deleted") },
            { value: "deny", label: t("settings.audit.denied") },
            { value: "redact", label: t("settings.audit.redacted") },
          ]}
        />

        <div className="ml-auto text-xs text-[var(--text-faint)]">
          {t("settings.audit.total", { count: total })}
        </div>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-[var(--text-faint)]">
          ...
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-[var(--text-faint)]">
          {t("common.error")}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--text-faint)]">
          {t("settings.audit.empty")}
        </div>
      ) : (
        <ol className="relative space-y-0 border-l border-[var(--border)] pl-5">
          {logs.map((log) => (
            <TimelineItem key={log.id} log={log} />
          ))}
        </ol>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className={cn(
              "rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors",
              offset === 0
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            {t("settings.audit.prev")}
          </button>
          <span className="text-xs text-[var(--text-faint)]">
            {t("settings.audit.page", { page: currentPage, total: totalPages })}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className={cn(
              "rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors",
              offset + PAGE_SIZE >= total
                ? "cursor-not-allowed opacity-40"
                : "hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            {t("settings.audit.next")}
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Timeline item
// ===========================================================================

function TimelineItem({
  log,
}: {
  log: {
    id: string;
    actorType: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId?: string;
    changes?: Record<string, unknown>;
    createdAt: string;
  };
}) {
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
      {/* Dot */}
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
          {formatTimestamp(log.createdAt)}
        </span>
      </div>

      <div className="mt-1 text-xs text-[var(--text-muted)]">
        <span className="text-[var(--text-faint)]">{log.actorType}</span>{" "}
        <span className="font-mono">{log.actorId}</span>
      </div>

      {/* Change details */}
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

  // If structured before/after, render both; otherwise render the raw object.
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
        {formatValue(value)}
      </pre>
    </div>
  );
}

// ===========================================================================
// Filter controls
// ===========================================================================

function FilterGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-[var(--surface-active)] font-medium text-[var(--text)]"
          : "text-[var(--text-muted)] hover:text-[var(--text)]",
      )}
    >
      {label}
    </button>
  );
}

function FilterSelect({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
