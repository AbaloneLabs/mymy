import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useExtensions } from "@/features/extensions/api";
import { ExtensionAddForm } from "./ExtensionAddForm";
import { ExtensionCard } from "./ExtensionCard";
import { McpServersPanel } from "./McpServersPanel";

export function ExtensionsSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useExtensions();
  const extensions = data?.extensions ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.extensions.add")}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}

      {!isLoading && extensions.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
          {t("settings.extensions.empty")}
        </div>
      )}

      <div className="space-y-2">
        {extensions.map((extension) => (
          <ExtensionCard key={extension.id} extension={extension} />
        ))}
      </div>

      {adding && <ExtensionAddForm onClose={() => setAdding(false)} />}

      <McpServersPanel />
    </div>
  );
}
