import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GitSystemType } from "@/types/settings";
import { useCreateProject } from "@/features/projects/api";
import { TextField } from "@/components/settings/TextField";
import { cn } from "@/lib/utils";


export function ProjectAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMutation = useCreateProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gitRemote, setGitRemote] = useState("");
  const [gitSystem, setGitSystem] = useState<GitSystemType | "">("");

  const handleSave = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      gitRemote: gitRemote.trim() || undefined,
      gitSystem: gitSystem || undefined,
    });
    onClose();
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--bg)] p-4">
      {/* name (required) */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{t("common.name")}</span>
        <TextField value={name} onChange={setName} placeholder={t("projects.namePlaceholder")} />
      </div>

      {/* description */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">{t("common.edit")}</span>
        <TextField
          value={description}
          onChange={setDescription}
          placeholder={t("projects.descriptionPlaceholder")}
        />
      </div>

      {/* git remote */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">Git URL</span>
        <TextField
          value={gitRemote}
          onChange={setGitRemote}
          placeholder={t("projects.gitRemotePlaceholder")}
        />
      </div>

      {/* git system */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
          {t("projects.gitSystem")}
        </span>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["", "github", "gitlab", "gitea"] as const).map((gs) => (
            <button
              key={gs || "none"}
              type="button"
              onClick={() => setGitSystem(gs)}
              className={cn(
                "px-3 py-1 text-xs transition-colors duration-150",
                gitSystem === gs
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              )}
            >
              {gs === "" ? t("projects.none") : gs}
            </button>
          ))}
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("projects.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim()}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150",
            name.trim()
              ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
              : "cursor-not-allowed bg-[var(--surface-active)] text-[var(--text-faint)]"
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("projects.add")}
        </button>
      </div>
    </div>
  );
}
