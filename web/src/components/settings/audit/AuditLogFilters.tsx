import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AuditLogAction, AuditLogActorType } from "@/types/audit";

export function AuditLogFilters({
  actorType,
  entityType,
  action,
  total,
  onActorChange,
  onEntityChange,
  onActionChange,
  onSelectSecurityDenials,
}: {
  actorType: "" | AuditLogActorType;
  entityType: string;
  action: "" | AuditLogAction;
  total: number;
  onActorChange: (value: "" | AuditLogActorType) => void;
  onEntityChange: (value: string) => void;
  onActionChange: (value: "" | AuditLogAction) => void;
  onSelectSecurityDenials: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterGroup>
        <FilterChip
          label={t("settings.audit.filterAll")}
          active={actorType === ""}
          onClick={() => onActorChange("")}
        />
        <FilterChip
          label={t("settings.audit.filterUser")}
          active={actorType === "user"}
          onClick={() => onActorChange("user")}
        />
        <FilterChip
          label={t("settings.audit.filterAgent")}
          active={actorType === "agent"}
          onClick={() => onActorChange("agent")}
        />
      </FilterGroup>

      <FilterChip
        label={t("settings.audit.security")}
        active={
          actorType === "agent" &&
          entityType === "filesystem_guard" &&
          action === "deny"
        }
        onClick={onSelectSecurityDenials}
      />

      <FilterSelect
        ariaLabel={t("settings.audit.entityType")}
        value={entityType}
        onChange={onEntityChange}
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

      <FilterSelect
        ariaLabel={t("settings.audit.action")}
        value={action}
        onChange={(value) => onActionChange(value as "" | AuditLogAction)}
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
  );
}

function FilterGroup({ children }: { children: ReactNode }) {
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
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
