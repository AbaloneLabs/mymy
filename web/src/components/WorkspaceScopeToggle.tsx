import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type WorkspaceListScope = "all" | "general";

export function WorkspaceScopeToggle({
  value,
  onChange,
}: {
  value: WorkspaceListScope;
  onChange: (value: WorkspaceListScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
        {(["all", "general"] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          onClick={() => onChange(scope)}
          className={cn(
            "rounded px-2.5 py-1 text-xs",
            value === scope
              ? "bg-[var(--surface-active)] text-[var(--text)]"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
          )}
        >
          {t(`workspaceScope.${scope}`)}
        </button>
        ))}
      </div>
      <span className="text-[10px] text-[var(--text-faint)]">
        {t("workspaceScope.newItemsGeneral")}
      </span>
    </div>
  );
}
