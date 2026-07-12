import type { ReactNode } from "react";
import {
  BookOpen,
  Calendar,
  CheckSquare,
  FileText,
  FolderGit2,
  MessageSquare,
  StickyNote,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  WorkspaceSearchDomain,
  WorkspaceSearchHit,
  WorkspaceSearchPartialFailure,
} from "@/types/search";
import { workspaceSearchHitKey } from "./omniSearchResults";

export function OmniSearchDropdown({
  query,
  hits,
  partialFailures,
  activeIndex,
  isFetching,
  onNavigate,
}: {
  query: string;
  hits: WorkspaceSearchHit[];
  partialFailures: WorkspaceSearchPartialFailure[];
  activeIndex: number;
  isFetching: boolean;
  onNavigate: (hit: WorkspaceSearchHit) => void;
}) {
  const { t } = useTranslation();
  const hasResults = hits.length > 0;
  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-full min-w-[24rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      role="listbox"
      aria-label={t("search.resultsLabel")}
    >
      {!hasResults && !isFetching && (
        <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t("search.noResults", { query })}
        </div>
      )}

      {hasResults && (
        <div className="py-1">
          {hits.map((hit, index) => (
            <ResultRow
              key={workspaceSearchHitKey(hit)}
              hit={hit}
              active={activeIndex === index}
              icon={domainIcon(hit.domain)}
              label={domainLabel(hit.domain, t)}
              locationsLabel={t("search.relatedLocations")}
              onClick={() => onNavigate(hit)}
              onLocationClick={(sourceLink) =>
                onNavigate({ ...hit, sourceLink })
              }
            />
          ))}
          <div className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
            {t("search.totalResults", { count: hits.length })}
          </div>
        </div>
      )}

      {partialFailures.length > 0 && (
        <div
          className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-amber-500"
          role="status"
        >
          {t("search.partialFailure", {
            domains: partialFailures
              .map((failure) => domainLabel(failure.domain, t))
              .join(", "),
          })}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  hit,
  active,
  icon,
  label,
  locationsLabel,
  onClick,
  onLocationClick,
}: {
  hit: WorkspaceSearchHit;
  active: boolean;
  icon: ReactNode;
  label: string;
  locationsLabel: string;
  onClick: () => void;
  onLocationClick: (sourceLink: WorkspaceSearchHit["sourceLink"]) => void;
}) {
  const metadata = [label, hit.scope, hit.lifecycleState, hit.freshness]
    .filter(Boolean)
    .join(" · ");
  const additionalLocations = hit.locations?.slice(1) ?? [];
  return (
    <div
      className={cn(
        "transition-colors duration-100",
        active ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onClick}
        className="flex w-full gap-2 px-3 py-2 text-left"
      >
        <span className="mt-0.5 shrink-0 text-[var(--text-faint)]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-[var(--text)]">{hit.title}</span>
          {hit.snippet && (
            <span className="block truncate text-[11px] text-[var(--text-muted)]">
              {hit.snippet}
            </span>
          )}
          <span className="block truncate text-[10px] text-[var(--text-faint)]">
            {metadata}
          </span>
        </span>
      </button>
      {additionalLocations.length > 0 && (
        <div className="flex flex-wrap gap-1 px-8 pb-2" aria-label={locationsLabel}>
          {additionalLocations.slice(0, 4).map((location, index) => (
            <button
              key={`${location.kind}:${location.sourceLink.id ?? index}`}
              type="button"
              onClick={() => onLocationClick(location.sourceLink)}
              className="max-w-[11rem] truncate rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:text-[var(--text)]"
            >
              {location.label ?? location.kind}
            </button>
          ))}
          {additionalLocations.length > 4 && (
            <span className="px-1 py-0.5 text-[10px] text-[var(--text-faint)]">
              +{additionalLocations.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function domainIcon(domain: WorkspaceSearchDomain) {
  const props = { className: "h-3.5 w-3.5", strokeWidth: 1.5 };
  switch (domain) {
    case "notes":
      return <StickyNote {...props} />;
    case "tasks":
      return <CheckSquare {...props} />;
    case "projects":
      return <FolderGit2 {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    case "sessions":
      return <MessageSquare {...props} />;
    case "knowledge":
      return <BookOpen {...props} />;
    case "drive":
      return <FileText {...props} />;
  }
}

function domainLabel(
  domain: WorkspaceSearchDomain,
  t: (key: string) => string,
) {
  switch (domain) {
    case "notes":
      return t("search.groupNotes");
    case "tasks":
      return t("search.groupTasks");
    case "projects":
      return t("search.groupProjects");
    case "calendar":
      return t("search.groupEvents");
    case "sessions":
      return t("search.groupMessages");
    case "knowledge":
      return t("search.groupKnowledge");
    case "drive":
      return t("search.groupDrive");
  }
}
