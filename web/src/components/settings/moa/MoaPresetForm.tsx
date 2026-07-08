import type { FormEvent } from "react";
import { Loader2, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LlmProvider } from "@/types/settings";
import { MoaProviderCheckbox } from "./MoaProviderCheckbox";

export type MoaPresetFormState = {
  name: string;
  enabled: boolean;
  proposerProviderIds: string[];
  aggregatorProviderId: string;
  maxConcurrent: number;
  aggregationPrompt: string;
};

export function MoaPresetForm({
  form,
  providers,
  isSaving,
  onFormChange,
  onToggleProposer,
  onCancel,
  onSubmit,
}: {
  form: MoaPresetFormState;
  providers: LlmProvider[];
  isSaving: boolean;
  onFormChange: (form: MoaPresetFormState) => void;
  onToggleProposer: (providerId: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
    >
      <div className="grid gap-3 md:grid-cols-[1fr_160px]">
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-muted)]">
            {t("settings.moa.name")}
          </span>
          <input
            value={form.name}
            onChange={(event) => onFormChange({ ...form, name: event.target.value })}
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
              onFormChange({
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
          onChange={(event) => onFormChange({ ...form, enabled: event.target.checked })}
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
              <MoaProviderCheckbox
                key={provider.id}
                provider={provider}
                checked={form.proposerProviderIds.includes(provider.id)}
                onChange={() => onToggleProposer(provider.id)}
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
              onFormChange({ ...form, aggregatorProviderId: event.target.value })
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
            onFormChange({ ...form, aggregationPrompt: event.target.value })
          }
          rows={3}
          className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
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
  );
}
