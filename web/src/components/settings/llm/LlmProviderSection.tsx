import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useLlmProviderRateLimits,
  useLlmProviders,
} from "@/features/llm-providers/api";
import { LlmProviderCard } from "./LlmProviderCard";
import { LlmProviderAddForm } from "./LlmProviderAddForm";
import { MoaPresetSection } from "../moa/MoaPresetSection";

export function LlmProviderSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useLlmProviders();
  const { data: rateLimitData } = useLlmProviderRateLimits();
  const providers = data?.providers ?? [];
  const rateLimits = new Map(
    (rateLimitData?.providers ?? []).map((status) => [
      status.providerId,
      status,
    ]),
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header + Add button */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.models.add")}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && providers.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
          {t("settings.models.empty")}
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-2">
        {providers.map((provider) => (
          <LlmProviderCard
            key={provider.id}
            provider={provider}
            rateLimitStatus={rateLimits.get(provider.id)}
          />
        ))}
      </div>

      {/* Add form */}
      {adding && (
        <LlmProviderAddForm onClose={() => setAdding(false)} />
      )}

      <MoaPresetSection />
    </div>
  );
}
