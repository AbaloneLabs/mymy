import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentSystemType } from "@/types/settings";
import { useCreateAgentSystem } from "@/features/agent-systems/api";
import { TextField } from "./TextField";
import { cn } from "@/lib/utils";


export function AgentSystemAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMutation = useCreateAgentSystem();
  const [type, setType] = useState<AgentSystemType>("hermes");
  const [label, setLabel] = useState("");
  const [connection, setConnection] = useState<"local" | "remote">("remote");
  const [cliPath, setCliPath] = useState("");
  const [profileDir, setProfileDir] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [sshUser, setSshUser] = useState("");
  const [remoteCliPath, setRemoteCliPath] = useState("");
  const [remoteProfileDir, setRemoteProfileDir] = useState("");

  const handleSave = () => {
    const typeLabel = type === "hermes" ? "Hermes" : "OpenClaw";
    const trimmedLabel = label.trim() || t("settings.agentSystem.newInstance", { label: typeLabel });
    createMutation.mutate({
      type,
      label: trimmedLabel,
      enabled: true,
      connection,
      ...(connection === "local"
        ? {
            cli_path: cliPath || undefined,
            profile_dir: profileDir || undefined,
          }
        : {
            host: host || undefined,
            port: Number(port) || 22,
            ssh_user: sshUser || undefined,
            remote_cli_path: remoteCliPath || undefined,
            remote_profile_dir: remoteProfileDir || undefined,
          }),
    });
    onClose();
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--bg)] p-4">

      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{t("common.system")}</span>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["hermes", "openclaw"] as const).map((ty) => (
            <button
              key={ty}
              type="button"
              onClick={() => setType(ty)}
              className={cn(
                "px-3 py-1 text-xs uppercase transition-colors duration-150",
                type === ty
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              )}
            >
              {ty}
            </button>
          ))}
        </div>
      </div>

      {/* label */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{t("common.name")}</span>
        <TextField value={label} onChange={setLabel} placeholder={t("settings.agentSystem.namePlaceholder")} />
      </div>

      {/* connection */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{t("common.connectionType")}</span>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["local", "remote"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setConnection(c)}
              className={cn(
                "px-3 py-1 text-xs transition-colors duration-150",
                connection === c
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              )}
            >
              {c === "local" ? t("common.local") : t("common.remote")}
            </button>
          ))}
        </div>
      </div>


      {connection === "local" ? (
        <>
          <LabeledInput label={t("common.cliPath")} value={cliPath} onChange={setCliPath} placeholder={t("settings.agentSystem.cliPathPlaceholder")} />
          <LabeledInput label={t("common.profileDir")} value={profileDir} onChange={setProfileDir} placeholder={t("settings.agentSystem.profileDirPlaceholder")} />
        </>
      ) : (
        <>
          <LabeledInput label={t("common.host")} value={host} onChange={setHost} placeholder={t("settings.agentSystem.hostPlaceholder")} />
          <LabeledInput label={t("common.port")} value={port} onChange={setPort} placeholder="22" full={false} />
          <LabeledInput label={t("common.sshUser")} value={sshUser} onChange={setSshUser} placeholder={t("settings.agentSystem.sshUserPlaceholder")} />
          <LabeledInput label={t("common.remoteCliPath")} value={remoteCliPath} onChange={setRemoteCliPath} placeholder={t("settings.agentSystem.cliPathPlaceholder")} />
          <LabeledInput label={t("common.remoteProfileDir")} value={remoteProfileDir} onChange={setRemoteProfileDir} placeholder={t("settings.agentSystem.profileDirPlaceholder")} />
        </>
      )}


      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)]"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("common.add")}
        </button>
      </div>
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
