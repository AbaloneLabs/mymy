import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/types/settings";

export function MoaProviderCheckbox({
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
        provider.enabled ? "text-[var(--text)]" : "text-[var(--text-faint)]",
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
