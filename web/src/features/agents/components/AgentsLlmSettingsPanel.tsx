import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Save, Sparkles } from "lucide-react";
import { useUpdateAgent } from "@/features/agents/api";
import {
  useLlmProviders,
  useSavedProviderModels,
} from "@/features/llm-providers/api";
import type { Agent } from "@/types/agents";

export function AgentLlmSettingsPanel({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const updateAgent = useUpdateAgent();
  const { data: providerData, isLoading: providersLoading } = useLlmProviders();
  const providers = useMemo(
    () => providerData?.providers ?? [],
    [providerData?.providers],
  );
  const globalProvider = providers.find((provider) => provider.is_default);
  const [inheritsGlobal, setInheritsGlobal] = useState(
    agent.llmSettings.inheritsGlobal,
  );
  const [providerId, setProviderId] = useState(
    agent.llmSettings.providerId ?? "",
  );
  const [model, setModel] = useState(agent.llmSettings.model ?? "");
  const modelProviderId = providerId || globalProvider?.id;
  const { data: modelData, isLoading: modelsLoading } =
    useSavedProviderModels(inheritsGlobal ? undefined : modelProviderId);
  const modelListId = `agent-models-${agent.profile}`;

  function save() {
    updateAgent.mutate({
      profile: agent.profile,
      body: {
        llmSettings: {
          providerId: inheritsGlobal ? null : providerId || null,
          model: inheritsGlobal ? null : model.trim() || null,
        },
      },
    });
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
            <Sparkles className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
            {t("agents.overview.llmTitle")}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("agents.overview.llmDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={updateAgent.isPending || providersLoading}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateAgent.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {t("common.save")}
        </button>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text)]">
        <input
          type="checkbox"
          checked={inheritsGlobal}
          onChange={(event) => setInheritsGlobal(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        {t("agents.overview.inheritGlobalLlm")}
      </label>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.overview.provider")}
          </span>
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
              setModel("");
            }}
            disabled={inheritsGlobal || providersLoading}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
          >
            <option value="">
              {t("agents.overview.globalProvider", {
                provider: globalProvider?.label ?? t("common.none"),
              })}
            </option>
            {providers.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={!provider.enabled}
              >
                {provider.label} · {provider.model}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.overview.model")}
          </span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={inheritsGlobal}
            list={modelListId}
            maxLength={256}
            placeholder={
              modelsLoading
                ? t("common.loading")
                : t("agents.overview.providerDefaultModel")
            }
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] disabled:opacity-60"
          />
          <datalist id={modelListId}>
            {(modelData?.models ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.display_name}
              </option>
            ))}
          </datalist>
        </label>
      </div>

      <div className="mt-3 rounded-md bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
        {t("agents.overview.effectiveLlm", {
          provider:
            agent.llmSettings.resolvedProviderLabel ?? t("common.none"),
          model: agent.llmSettings.resolvedModel ?? t("common.none"),
        })}
        {agent.llmSettings.resolvedProviderEnabled === false && (
          <span className="ml-2 text-[var(--status-error)]">
            {t("agents.overview.providerUnavailable")}
          </span>
        )}
      </div>

      {updateAgent.isError && (
        <p className="mt-2 text-xs text-[var(--status-error)]">
          {t("agents.overview.llmSaveError")}
        </p>
      )}
    </section>
  );
}
