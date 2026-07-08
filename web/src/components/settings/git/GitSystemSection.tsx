import { useTranslation } from "react-i18next";
import type { GitSystemConfig, GitSystemType } from "@/types/settings";
import { useSettingsStore } from "@/store/settings";
import { Toggle } from "../shared/Toggle";
import { TextField } from "../shared/TextField";
import { cn } from "@/lib/utils";

const LABELS: Record<GitSystemType, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
};


export function GitSystemSection() {
  const gitSystems = useSettingsStore((s) => s.settings.gitSystems);
  const updateGitSystem = useSettingsStore((s) => s.updateGitSystem);

  const types: GitSystemType[] = ["github", "gitlab", "gitea"];

  return (
    <div className="space-y-3">
      {types.map((type) => (
        <GitSystemCard
          key={type}
          config={gitSystems[type]}
          onChange={(patch) => updateGitSystem(type, patch)}
        />
      ))}
    </div>
  );
}

function GitSystemCard({
  config,
  onChange,
}: {
  config: GitSystemConfig;
  onChange: (patch: Partial<GitSystemConfig>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--text)]">{LABELS[config.type]}</span>
        <Toggle
          checked={config.enabled}
          onChange={(enabled) => onChange({ enabled })}
          ariaLabel={t("settings.git.enable", { type: LABELS[config.type] })}
        />
      </div>


      {config.enabled && (
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
          <LabeledInput
            label={t("common.host")}
            value={config.host}
            onChange={(host) => onChange({ host })}
            placeholder={t("settings.git.hostPlaceholder")}
          />
          <LabeledInput
            label={t("common.port")}
            value={String(config.port)}
            onChange={(port) => onChange({ port: Number(port) || 22 })}
            placeholder="22"
            full={false}
          />
          <LabeledInput
            label={t("settings.git.sshAlias")}
            value={config.sshAlias}
            onChange={(sshAlias) => onChange({ sshAlias })}
            placeholder={config.type}
          />
          <LabeledInput
            label={t("settings.git.username")}
            value={config.username}
            onChange={(username) => onChange({ username })}
            placeholder={t("settings.git.usernamePlaceholder")}
          />
        </div>
      )}
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
      <span className={cn("w-20 shrink-0 text-xs text-[var(--text-muted)]")}>{label}</span>
      <TextField value={value} onChange={onChange} placeholder={placeholder} full={full} />
    </div>
  );
}
