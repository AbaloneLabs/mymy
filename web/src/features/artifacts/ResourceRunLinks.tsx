import { History } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useResourceProvenance } from "./api";

/**
 * Stable-resource reverse navigation intentionally exposes only bounded Run
 * identity and effect metadata. The destination Run page remains responsible
 * for authorizing and rendering objectives, events, and session context.
 */
export function ResourceRunLinks({ resourceId }: { resourceId?: string }) {
  const { t } = useTranslation();
  const provenance = useResourceProvenance(resourceId);
  const runs = provenance.data?.runs ?? [];

  if (!resourceId || provenance.isLoading || runs.length === 0) return null;
  if (provenance.isError) {
    return (
      <p className="text-[10px] text-[var(--status-error)]">
        {t("artifacts.reverseLinksError")}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
      <History className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{t("artifacts.relatedRuns")}</span>
      {runs.slice(0, 3).map((run) => (
        <Link
          key={run.runId}
          to={`/agents?tab=overview&runId=${encodeURIComponent(run.runId)}`}
          className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
          title={`${run.agentProfile} · ${run.effectKind}`}
        >
          {run.agentProfile} · {run.effectKind}
        </Link>
      ))}
      {runs.length > 3 && <span>+{runs.length - 3}</span>}
    </div>
  );
}
