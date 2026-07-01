import { useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateMoaPreset,
  useDeleteMoaPreset,
  useMoaPresets,
  useUpdateMoaPreset,
  type MoaPreset,
  type UpsertMoaPresetRequest,
} from "@/features/moa/api";
import { useLlmProviders } from "@/features/llm-providers/api";
import type { LlmProvider } from "@/types/settings";
import { cn } from "@/lib/utils";

const DEFAULT_AGGREGATION_PROMPT =
  "Synthesize the proposer outputs into one final answer.";

type FormState = {
  name: string;
  enabled: boolean;
  proposerProviderIds: string[];
  aggregatorProviderId: string;
  maxConcurrent: number;
  aggregationPrompt: string;
};

export function MoaPresetSection() {
  const { t } = useTranslation();
  const { data: presetsData, isLoading: presetsLoading } = useMoaPresets();
  const { data: providersData, isLoading: providersLoading } = useLlmProviders();
  const createMutation = useCreateMoaPreset();
  const updateMutation = useUpdateMoaPreset();
  const deleteMutation = useDeleteMoaPreset();
  const providers = useMemo(
    () => providersData?.providers ?? [],
    [providersData?.providers],
  );
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const presets = presetsData?.presets ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const isLoading = presetsLoading || providersLoading;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function startCreate() {
    setEditingId(null);
    setForm({
      name: "",
      enabled: true,
      proposerProviderIds: enabledProviders.slice(0, 2).map((provider) => provider.id),
      aggregatorProviderId: enabledProviders[0]?.id ?? "",
      maxConcurrent: Math.min(3, Math.max(enabledProviders.length, 1)),
      aggregationPrompt: DEFAULT_AGGREGATION_PROMPT,
    });
  }

  function startEdit(preset: MoaPreset) {
    setEditingId(preset.id);
    setForm({
      name: preset.name,
      enabled: preset.enabled,
      proposerProviderIds: preset.proposerProviderIds,
      aggregatorProviderId: preset.aggregatorProviderId,
      maxConcurrent: preset.maxConcurrent,
      aggregationPrompt: preset.aggregationPrompt,
    });
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const body: UpsertMoaPresetRequest = {
      name: form.name.trim(),
      enabled: form.enabled,
      proposerProviderIds: form.proposerProviderIds,
      aggregatorProviderId: form.aggregatorProviderId,
      maxConcurrent: form.maxConcurrent,
      aggregationPrompt: form.aggregationPrompt.trim(),
    };
    if (!body.name || !body.aggregatorProviderId || body.proposerProviderIds.length === 0) {
      return;
    }
    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, body });
    } else {
      await createMutation.mutateAsync(body);
    }
    setEditingId(null);
    setForm(null);
  }

  function toggleProposer(providerId: string) {
    if (!form) return;
    const exists = form.proposerProviderIds.includes(providerId);
    setForm({
      ...form,
      proposerProviderIds: exists
        ? form.proposerProviderIds.filter((id) => id !== providerId)
        : [...form.proposerProviderIds, providerId],
    });
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--text)]">
            {t("settings.moa.title")}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {t("settings.moa.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          disabled={Boolean(form) || enabledProviders.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.moa.add")}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-5 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}

      {!isLoading && providers.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.moa.noProviders")}
        </div>
      )}

      {!isLoading && providers.length > 0 && presets.length === 0 && !form && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.moa.empty")}
        </div>
      )}

      <div className="space-y-2">
        {presets.map((preset) => (
          <MoaPresetRow
            key={preset.id}
            preset={preset}
            providerById={providerById}
            onEdit={() => startEdit(preset)}
            onDelete={() => deleteMutation.mutate(preset.id)}
            busy={deleteMutation.isPending || Boolean(form)}
          />
        ))}
      </div>

      {form && (
        <form
          onSubmit={(event) => void submitForm(event)}
          className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
        >
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-muted)]">
                {t("settings.moa.name")}
              </span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-muted)]">
                {t("settings.moa.maxConcurrent")}
              </span>
              <input
                type="number"
                min={1}
                max={8}
                value={form.maxConcurrent}
                onChange={(event) =>
                  setForm({
                    ...form,
                    maxConcurrent: Number(event.target.value),
                  })
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            {t("settings.moa.enabled")}
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-xs text-[var(--text-muted)]">
                {t("settings.moa.proposers")}
              </div>
              <div className="max-h-36 space-y-1 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-2">
                {providers.map((provider) => (
                  <ProviderCheckbox
                    key={provider.id}
                    provider={provider}
                    checked={form.proposerProviderIds.includes(provider.id)}
                    onChange={() => toggleProposer(provider.id)}
                  />
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-xs text-[var(--text-muted)]">
                {t("settings.moa.aggregator")}
              </span>
              <select
                value={form.aggregatorProviderId}
                onChange={(event) =>
                  setForm({ ...form, aggregatorProviderId: event.target.value })
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="">{t("settings.moa.selectProvider")}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label} · {provider.model}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs text-[var(--text-muted)]">
              {t("settings.moa.aggregationPrompt")}
            </span>
            <textarea
              value={form.aggregationPrompt}
              onChange={(event) =>
                setForm({ ...form, aggregationPrompt: event.target.value })
              }
              rows={3}
              className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("settings.moa.cancel")}
            </button>
            <button
              type="submit"
              disabled={
                isSaving ||
                !form.name.trim() ||
                !form.aggregatorProviderId ||
                form.proposerProviderIds.length === 0
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {t("settings.moa.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function MoaPresetRow({
  preset,
  providerById,
  onEdit,
  onDelete,
  busy,
}: {
  preset: MoaPreset;
  providerById: Map<string, LlmProvider>;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const proposers = preset.proposerProviderIds
    .map((id) => providerById.get(id)?.label ?? id)
    .join(", ");
  const aggregator =
    providerById.get(preset.aggregatorProviderId)?.label ??
    preset.aggregatorProviderId;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--text)]">
              {preset.name}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] uppercase",
                preset.enabled
                  ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                  : "bg-[var(--surface-hover)] text-[var(--text-muted)]",
              )}
            >
              {preset.enabled ? t("settings.moa.enabled") : t("settings.moa.disabled")}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {t("settings.moa.proposers")}: {proposers}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            {t("settings.moa.aggregator")}: {aggregator}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.moa.edit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("settings.moa.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderCheckbox({
  provider,
  checked,
  onChange,
}: {
  provider: LlmProvider;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded px-1.5 py-1 text-xs",
        provider.enabled
          ? "text-[var(--text)]"
          : "text-[var(--text-faint)]",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={!provider.enabled && !checked}
      />
      <span className="min-w-0 flex-1 truncate">
        {provider.label} · {provider.model}
      </span>
    </label>
  );
}
