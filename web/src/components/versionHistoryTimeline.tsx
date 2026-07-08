import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EntityVersionSummary } from "@/types/versions";

export function VersionHistoryTimeline({
  versions,
  loading,
  selectedVersionId,
  onSelect,
}: {
  versions: EntityVersionSummary[];
  loading: boolean;
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-[var(--text-dim)]">
        <Loader2 size={14} className="mr-2 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-[var(--text-dim)]">
        {t("notes.noVersions")}
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {versions.map((version, index) => (
        <li key={version.id}>
          <button
            onClick={() => onSelect(version.id)}
            className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
              selectedVersionId === version.id
                ? "bg-[var(--surface-hover)]"
                : "hover:bg-[var(--surface-hover)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  index === 0 ? "bg-[var(--accent)]" : "bg-[var(--text-dim)]"
                }`}
              />
              <span className="text-xs font-medium text-[var(--text)]">
                v{version.versionNum}
                {index === 0 && (
                  <span className="ml-1.5 text-[10px] text-[var(--accent)]">
                    {t("notes.currentVersion")}
                  </span>
                )}
              </span>
              <span className="ml-auto text-[10px] text-[var(--text-dim)]">
                {formatRelative(version.createdAt)}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--text-dim)]">
              {version.changeSummary}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}
