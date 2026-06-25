import { useState } from "react";
import { Pencil, Trash2, Check, X, Cpu, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentSystemInstance } from "@/types/settings";
import { useUpdateAgentSystem, useDeleteAgentSystem } from "@/features/agent-systems/api";
import { Toggle } from "./Toggle";
import { DiscoveryBadge } from "./DiscoveryBadge";
import { StatusBadge } from "./StatusBadge";
import { TextField } from "./TextField";
import { cn } from "@/lib/utils";

interface AgentSystemCardProps {
  instance: AgentSystemInstance;
}


export function AgentSystemCard({ instance }: AgentSystemCardProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateAgentSystem();
  const deleteMutation = useDeleteAgentSystem();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(instance);

  const isAuto = instance.source === "auto";
  const isRemote = instance.connection === "remote";

  const startEdit = () => {
    setDraft(instance);
    setEditing(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      id: instance.id,
      body: {
        label: draft.label,
        enabled: draft.enabled,
        connection: draft.connection,
        cli_path: draft.cliPath,
        profile_dir: draft.profileDir,
        host: draft.host,
        port: draft.port,
        ssh_user: draft.sshUser,
        remote_cli_path: draft.remoteCliPath,
        remote_profile_dir: draft.remoteProfileDir,
      },
    });
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(instance);
    setEditing(false);
  };

  const handleRemove = () => {
    deleteMutation.mutate(instance.id);
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-active)] text-[var(--text-muted)]">
            {isRemote ? (
              <Cloud className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Cpu className="h-4 w-4" strokeWidth={1.5} />
            )}
          </div>
          <div>
            {editing ? (
              <TextField
                value={draft.label}
                onChange={(label) => setDraft({ ...draft, label })}
                placeholder={t("settings.agentSystem.instanceName")}
                full={false}
                className="w-48"
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text)]">{instance.label}</span>
                <DiscoveryBadge source={instance.source} />
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="uppercase">{instance.type}</span>
              <span>·</span>
              <span>{isRemote ? t("common.remote") : t("common.local")}</span>
              {instance.status && (
                <>
                  <span>·</span>
                  <StatusBadge status={instance.status} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <IconBtn onClick={saveEdit} label={t("common.save")}>
                <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconBtn>
              <IconBtn onClick={cancelEdit} label={t("common.cancel")}>
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconBtn>
            </>
          ) : (
            <>
              <Toggle
                checked={instance.enabled}
                onChange={(enabled) =>
                  updateMutation.mutate({ id: instance.id, body: { enabled } })
                }
                ariaLabel={t("status.enable", { label: instance.label })}
              />
              <IconBtn onClick={startEdit} label={t("common.edit")}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              </IconBtn>

              {!isAuto && (
                <IconBtn onClick={handleRemove} label={t("common.delete")} danger>
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </IconBtn>
              )}
            </>
          )}
        </div>
      </div>


      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        {editing ? (
          <EditFields draft={draft} setDraft={setDraft} />
        ) : (
          <ViewFields instance={instance} />
        )}
      </div>
    </div>
  );
}


function ViewFields({ instance }: { instance: AgentSystemInstance }) {
  const { t } = useTranslation();
  const isRemote = instance.connection === "remote";
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {isRemote ? (
        <>
          <Field label={t("common.host")} value={instance.host ? `${instance.host}:${instance.port ?? 22}` : "—"} />
          <Field label={t("common.sshUser")} value={instance.sshUser || "—"} />
          <Field label={t("common.remoteCliPath")} value={instance.remoteCliPath || "—"} />
          <Field label={t("common.remoteProfileDir")} value={instance.remoteProfileDir || "—"} />
        </>
      ) : (
        <>
          <Field label={t("common.cliPath")} value={instance.cliPath || "—"} />
          <Field label={t("common.profileDir")} value={instance.profileDir || "—"} />
        </>
      )}
      {instance.detectedAgents != null && (
        <Field label={t("settings.agentSystem.detectedAgents")} value={t("common.units", { count: instance.detectedAgents })} />
      )}
    </dl>
  );
}


function EditFields({
  draft,
  setDraft,
}: {
  draft: AgentSystemInstance;
  setDraft: (d: AgentSystemInstance) => void;
}) {
  const { t } = useTranslation();
  const isRemote = draft.connection === "remote";
  return (
    <div className="space-y-2">

      <div className="flex items-center gap-2">
        <span className="w-24 text-xs text-[var(--text-muted)]">{t("common.connectionType")}</span>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["local", "remote"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDraft({ ...draft, connection: c })}
              className={cn(
                "px-2.5 py-1 text-xs transition-colors duration-150",
                draft.connection === c
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              )}
            >
              {c === "local" ? t("common.local") : t("common.remote")}
            </button>
          ))}
        </div>
      </div>

      {isRemote ? (
        <>
          <LabeledInput
            label={t("common.host")}
            value={draft.host ?? ""}
            onChange={(host) => setDraft({ ...draft, host })}
            placeholder={t("settings.agentSystem.hostPlaceholder")}
          />
          <LabeledInput
            label={t("common.port")}
            value={String(draft.port ?? 22)}
            onChange={(port) => setDraft({ ...draft, port: Number(port) || 22 })}
            placeholder="22"
            full={false}
          />
          <LabeledInput
            label={t("common.sshUser")}
            value={draft.sshUser ?? ""}
            onChange={(sshUser) => setDraft({ ...draft, sshUser })}
            placeholder={t("settings.agentSystem.sshUserPlaceholder")}
          />
          <LabeledInput
            label={t("common.remoteCliPath")}
            value={draft.remoteCliPath ?? ""}
            onChange={(remoteCliPath) => setDraft({ ...draft, remoteCliPath })}
            placeholder={t("settings.agentSystem.cliPathPlaceholder")}
          />
          <LabeledInput
            label={t("common.remoteProfileDir")}
            value={draft.remoteProfileDir ?? ""}
            onChange={(remoteProfileDir) => setDraft({ ...draft, remoteProfileDir })}
            placeholder={t("settings.agentSystem.profileDirPlaceholder")}
          />
        </>
      ) : (
        <>
          <LabeledInput
            label={t("common.cliPath")}
            value={draft.cliPath ?? ""}
            onChange={(cliPath) => setDraft({ ...draft, cliPath })}
            placeholder={t("settings.agentSystem.cliPathPlaceholder")}
          />
          <LabeledInput
            label={t("common.profileDir")}
            value={draft.profileDir ?? ""}
            onChange={(profileDir) => setDraft({ ...draft, profileDir })}
            placeholder={t("settings.agentSystem.profileDirPlaceholder")}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 font-mono text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  full = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
      <TextField value={value} onChange={onChange} placeholder={placeholder} full={full} />
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150",
        danger
          ? "text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      )}
    >
      {children}
    </button>
  );
}
