import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";
import { useCreateAgent } from "@/features/agents/api";

export function CreateAgentPanel({
  onCreated,
}: {
  onCreated: (profile: string) => void;
}) {
  const { t } = useTranslation();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const busy = createAgent.isPending;
  const canSubmit = name.trim().length > 0 && !busy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    createAgent.mutate(
      {
        name,
        profile: profile.trim() || undefined,
        role: role.trim() || undefined,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setName("");
          setProfile("");
          setRole("");
          setDescription("");
          onCreated(res.agent.profile);
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Plus className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
        {t("agents.all.addTitle")}
      </div>
      <form onSubmit={handleSubmit} className="grid gap-3 lg:grid-cols-4">
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.name")}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.profileOptional")}
          </span>
          <input
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.role")}
          </span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            maxLength={120}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.description")}
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex items-end gap-2 lg:col-span-4">
          {createAgent.isError && (
            <span className="text-xs text-[var(--status-error)]">
              {t("agents.all.createError")}
            </span>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t("agents.all.create")}
          </button>
        </div>
      </form>
    </section>
  );
}
