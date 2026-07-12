import { useState } from "react";
import {
  Check,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  settingsApiErrorCode,
  useApproveQuarantine,
  useDeleteQuarantine,
  usePendingQuarantine,
  useSecurityStatus,
} from "@/features/settings/api";
import { cn } from "@/lib/utils";
import type { ContentFindingCode, QuarantineItem } from "@/types/settings";

export function SecuritySection() {
  const { t } = useTranslation();
  const { data } = useSecurityStatus();
  const quarantine = usePendingQuarantine();
  const approve = useApproveQuarantine();
  const remove = useDeleteQuarantine();
  const [conflictId, setConflictId] = useState<string>();
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string>();
  const quarantineItems =
    quarantine.data?.pages.flatMap((page) => page.items) ?? [];

  const rows = [
    {
      label: t("settings.security.redaction"),
      enabled: data?.redactionEnabled ?? false,
    },
    {
      label: t("settings.security.filesystemGuard"),
      enabled: data?.filesystemGuardEnabled ?? false,
    },
    {
      label: t("settings.security.tlsValidation"),
      enabled: data?.tlsValidationEnabled ?? false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
          >
            <div className="flex items-center gap-2">
              {row.enabled ? (
                <ShieldCheck
                  className="h-4 w-4 text-[var(--status-success)]"
                  strokeWidth={1.5}
                />
              ) : (
                <ShieldAlert
                  className="h-4 w-4 text-[var(--status-error)]"
                  strokeWidth={1.5}
                />
              )}
              <span className="text-sm font-medium text-[var(--text)]">
                {row.label}
              </span>
            </div>
            <div
              className={cn(
                "mt-2 text-xs",
                row.enabled
                  ? "text-[var(--status-success)]"
                  : "text-[var(--status-error)]",
              )}
            >
              {row.enabled
                ? t("settings.security.enabled")
                : t("settings.security.disabled")}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="text-sm font-medium text-[var(--text)]">
          {t("settings.security.secretSources")}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(data?.secretSources ?? []).map((source) => (
            <span
              key={source.name}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                source.configured
                  ? "border-[var(--status-success)]/30 text-[var(--status-success)]"
                  : "border-[var(--border)] text-[var(--text-muted)]",
              )}
            >
              {source.configured && <Check className="h-3 w-3" strokeWidth={2} />}
              {source.name}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--text)]">
              {t("settings.security.contentReview")}
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("settings.security.contentReviewDescription")}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              data?.quarantineCapacityAvailable === false
                ? "border-[var(--status-error)]/40 text-[var(--status-error)]"
                : "border-[var(--border)] text-[var(--text-muted)]",
            )}
          >
            {t("settings.security.pendingCount", {
              count: data?.pendingQuarantineCount ?? 0,
            })}
          </span>
        </div>

        {data?.contentEngineEnabled && (
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            {t("settings.security.policyVersion", {
              version: data.contentPolicyVersion,
            })}
          </div>
        )}

        {data?.quarantineCapacityAvailable === false && (
          <div className="mt-3 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-2 text-xs text-[var(--status-error)]">
            {t("settings.security.capacityFull")}
          </div>
        )}

        {actionError && (
          <div className="mt-3 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-2 text-xs text-[var(--status-error)]">
            {actionError}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {quarantine.isLoading && (
            <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {t("settings.security.loadingReviews")}
            </div>
          )}
          {quarantine.isError && (
            <div className="py-3 text-xs text-[var(--status-error)]">
              {t("settings.security.reviewLoadError")}
            </div>
          )}
          {!quarantine.isLoading &&
            !quarantine.isError &&
            quarantineItems.length === 0 && (
              <div className="py-4 text-xs text-[var(--text-muted)]">
                {t("settings.security.noPendingReviews")}
              </div>
            )}
          {quarantineItems.map((item) => (
            <QuarantineCard
              key={item.id}
              item={item}
              conflict={conflictId === item.id}
              destination={destinations[item.id] ?? item.desiredPath}
              approving={approve.isPending && approve.variables?.id === item.id}
              deleting={remove.isPending && remove.variables?.id === item.id}
              onDestinationChange={(value) =>
                setDestinations((current) => ({ ...current, [item.id]: value }))
              }
              onApprove={() => {
                setActionError(undefined);
                approve.mutate(
                  {
                    id: item.id,
                    expectedVersion: item.version,
                    destinationPath:
                      conflictId === item.id
                        ? destinations[item.id]
                        : undefined,
                  },
                  {
                    onSuccess: () => setConflictId(undefined),
                    onError: (error) => {
                      const code = settingsApiErrorCode(error);
                      if (code === "quarantine_destination_conflict") {
                        setConflictId(item.id);
                        setActionError(
                          t("settings.security.destinationConflict"),
                        );
                      } else if (code === "stale_quarantine_version") {
                        setActionError(t("settings.security.staleReview"));
                      } else if (code === "content_policy_changed") {
                        setActionError(t("settings.security.policyChanged"));
                      } else if (code === "step_up_required") {
                        setActionError(t("settings.security.reauthRequired"));
                      } else {
                        setActionError(t("settings.security.reviewActionError"));
                      }
                    },
                  },
                );
              }}
              onDelete={() => {
                setActionError(undefined);
                remove.mutate(
                  { id: item.id, expectedVersion: item.version },
                  {
                    onError: (error) =>
                      setActionError(
                        settingsApiErrorCode(error) === "stale_quarantine_version"
                          ? t("settings.security.staleReview")
                          : t("settings.security.reviewActionError"),
                      ),
                  },
                );
              }}
            />
          ))}
          {quarantine.hasNextPage && (
            <button
              type="button"
              disabled={quarantine.isFetchingNextPage}
              onClick={() => void quarantine.fetchNextPage()}
              className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50"
            >
              {quarantine.isFetchingNextPage
                ? t("common.loading")
                : t("common.showMore")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuarantineCard({
  item,
  conflict,
  destination,
  approving,
  deleting,
  onDestinationChange,
  onApprove,
  onDelete,
}: {
  item: QuarantineItem;
  conflict: boolean;
  destination: string;
  approving: boolean;
  deleting: boolean;
  onDestinationChange: (value: string) => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const disabled = approving || deleting;
  return (
    <article className="rounded-md border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {item.normalizedName}
          </div>
          <div className="mt-1 break-all text-xs text-[var(--text-muted)]">
            {item.desiredPath}
          </div>
        </div>
        <div className="text-right text-xs text-[var(--text-muted)]">
          <div>{formatBytes(item.size)}</div>
          <div>{item.detectedType}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>
          {t(`settings.security.origins.${item.origin}`)}
          {item.actorLabel ? ` · ${item.actorLabel}` : ""}
        </span>
        <time dateTime={item.createdAt}>
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(item.createdAt))}
        </time>
      </div>

      <ul className="mt-2 space-y-1">
        {item.findings.map((finding) => (
          <li
            key={finding.code}
            className="flex items-start gap-1.5 text-xs text-[var(--status-error)]"
          >
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {findingLabel(t, finding.code)}
          </li>
        ))}
      </ul>

      {conflict && (
        <label className="mt-3 block text-xs text-[var(--text-muted)]">
          {t("settings.security.newDestination")}
          <input
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            value={destination}
            onChange={(event) => onDestinationChange(event.target.value)}
          />
        </label>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] disabled:opacity-50"
        >
          {deleting ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {t("settings.security.deleteReview")}
        </button>
        <button
          type="button"
          disabled={disabled || (conflict && destination.trim().length === 0)}
          onClick={onApprove}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {approving ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
          {conflict
            ? t("settings.security.approveAs")
            : t("settings.security.approveReview")}
        </button>
      </div>
    </article>
  );
}

function findingLabel(
  t: ReturnType<typeof useTranslation>["t"],
  code: ContentFindingCode,
) {
  return t(`settings.security.findings.${code}`);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
