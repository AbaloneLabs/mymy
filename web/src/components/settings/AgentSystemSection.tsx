import { useState } from "react";
import { RefreshCw, Plus, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentSystemType } from "@/types/settings";
import { useAgentSystems, useDiscoverAgentSystems } from "@/features/agent-systems/api";
import { AgentSystemCard } from "./AgentSystemCard";
import { AgentSystemAddForm } from "./AgentSystemAddForm";
import { cn } from "@/lib/utils";


export function AgentSystemSection() {
  const { t } = useTranslation();
  const { data } = useAgentSystems();
  const discover = useDiscoverAgentSystems();
  const instances = data?.instances ?? [];
  const [adding, setAdding] = useState<AgentSystemType | null>(null);

  return (
    <div className="space-y-3">

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => discover.mutate()}
          disabled={discover.isPending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)]",
            "transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {discover.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("settings.agentSystem.redetect")}
        </button>
        <button
          type="button"
          onClick={() => setAdding("hermes")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)]",
            "transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.agentSystem.addHermes")}
        </button>
        <button
          type="button"
          onClick={() => setAdding("openclaw")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)]",
            "transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.agentSystem.addOpenClaw")}
        </button>
      </div>


      {instances.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
          {t("settings.agentSystem.empty")}
        </div>
      )}

      <div className="space-y-2">
        {instances.map((inst) => (
          <AgentSystemCard key={inst.id} instance={inst} />
        ))}
      </div>


      {adding && (
        <div>
          <div className="mb-1.5 text-xs text-[var(--text-muted)]">
            {t("settings.agentSystem.addNew", { type: adding === "hermes" ? "Hermes" : "OpenClaw" })}
          </div>
          <AgentSystemAddForm onClose={() => setAdding(null)} />
        </div>
      )}
    </div>
  );
}
