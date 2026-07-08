import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MoaPreset } from "@/features/moa/api";
import type { LlmProvider } from "@/types/settings";

export function MoaPresetRow({
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
