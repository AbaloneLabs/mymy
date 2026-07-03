import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save } from "lucide-react";
import {
  type AgentPromptsResponse,
  useAgentPrompts,
  useUpdateAgentPrompts,
} from "@/features/agent-ops/api";
import { cn } from "@/lib/utils";
import { PanelError, PanelLoading } from "./AgentsNativeShared";
import { formatDate } from "./AgentsNativeUtils";

export function PromptTab({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentPrompts(profile);

  if (isLoading) return <PanelLoading />;
  if (isError || !data) {
    return <PanelError message={t("agents.prompt.loadError")} />;
  }

  return (
    <PromptEditorForm
      key={[
        data.profile,
        data.agentsMd.updatedAt ?? "new-agents",
        data.soulMd.updatedAt ?? "new-soul",
      ].join(":")}
      profile={profile}
      data={data}
    />
  );
}

function PromptEditorForm({
  profile,
  data,
}: {
  profile: string;
  data: AgentPromptsResponse;
}) {
  const { t } = useTranslation();
  const updateMutation = useUpdateAgentPrompts(profile);
  const [agentsDraft, setAgentsDraft] = useState(data.agentsMd.content);
  const [soulDraft, setSoulDraft] = useState(data.soulMd.content);
  const dirty =
    agentsDraft !== data.agentsMd.content || soulDraft !== data.soulMd.content;
  const busy = updateMutation.isPending;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <PromptEditor
          title="AGENTS.md"
          path={data.agentsMd.path}
          exists={data.agentsMd.exists}
          updatedAt={data.agentsMd.updatedAt}
          value={agentsDraft}
          onChange={setAgentsDraft}
        />
        <PromptEditor
          title="SOUL.md"
          path={data.soulMd.path}
          exists={data.soulMd.exists}
          updatedAt={data.soulMd.updatedAt}
          value={soulDraft}
          onChange={setSoulDraft}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {updateMutation.isError && (
          <span className="mr-auto text-xs text-[var(--status-error)]">
            {t("agents.prompt.saveError")}
          </span>
        )}
        {updateMutation.isSuccess && !dirty && (
          <span className="mr-auto text-xs text-[var(--status-success)]">
            {t("agents.prompt.saved")}
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            updateMutation.mutate({
              agentsMd: agentsDraft,
              soulMd: soulDraft,
            })
          }
          disabled={!dirty || busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("agents.prompt.save")}
        </button>
      </div>
    </div>
  );
}

function PromptEditor({
  title,
  path,
  exists,
  updatedAt,
  value,
  onChange,
}: {
  title: string;
  path: string;
  exists: boolean;
  updatedAt?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">{title}</h2>
          <code className="mt-1 block truncate font-mono text-[11px] text-[var(--text-faint)]">
            {path}
          </code>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
            exists
              ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
              : "bg-[var(--surface-hover)] text-[var(--text-muted)]",
          )}
        >
          {exists ? t("agents.prompt.exists") : t("agents.prompt.newFile")}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="h-[460px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {updatedAt && (
        <div className="mt-2 text-[11px] text-[var(--text-faint)]">
          {t("agents.prompt.updated")}: {formatDate(updatedAt)}
        </div>
      )}
    </section>
  );
}
