import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { MoaPresetForm, type MoaPresetFormState } from "./MoaPresetForm";
import { MoaPresetRow } from "./MoaPresetRow";

const DEFAULT_AGGREGATION_PROMPT =
  "Synthesize the proposer outputs into one final answer.";

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
  const [form, setForm] = useState<MoaPresetFormState | null>(null);
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
        <MoaPresetForm
          form={form}
          providers={providers}
          isSaving={isSaving}
          onFormChange={setForm}
          onToggleProposer={toggleProposer}
          onCancel={() => {
            setEditingId(null);
            setForm(null);
          }}
          onSubmit={(event) => void submitForm(event)}
        />
      )}
    </div>
  );
}
