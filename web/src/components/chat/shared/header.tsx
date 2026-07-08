import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MoaPreset } from "@/features/moa/api";

export function ChatHeader({
  agentName,
  agentRole,
  moaPresets,
  selectedMoaPreset,
  useMoa,
  onUseMoaChange,
  onMoaPresetChange,
}: {
  agentName?: string;
  agentRole?: string;
  moaPresets: MoaPreset[];
  selectedMoaPreset: MoaPreset | null;
  useMoa: boolean;
  onUseMoaChange: (enabled: boolean) => void;
  onMoaPresetChange: (presetId: string) => void;
}) {
  const { t } = useTranslation();
  const initial = agentName?.trim().charAt(0).toUpperCase() ?? "?";

  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-sm font-semibold text-white">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--text)]">
          {agentName ?? t("agents.title")}
        </div>
        {agentRole && (
          <div className="truncate text-xs text-[var(--text-muted)]">
            {agentRole}
          </div>
        )}
      </div>
      {moaPresets.length > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onUseMoaChange(!useMoa)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
              useMoa
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <Network className="h-3.5 w-3.5" strokeWidth={1.5} />
            MoA
          </button>
          <select
            value={selectedMoaPreset?.id ?? ""}
            onChange={(event) => onMoaPresetChange(event.target.value)}
            disabled={!useMoa}
            className="h-8 max-w-[220px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] disabled:opacity-50"
          >
            {moaPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
