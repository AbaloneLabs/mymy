import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDriveTrash,
  usePurgeDriveTrash,
  useRestoreDriveTrash,
} from "@/features/drive/api";
import { formatBytes, formatDate } from "@/features/drive/utils";
import { createUuid } from "@/lib/uuid";
import type { DriveTrashEntry } from "@/types/drive";

export function DriveTrashPane({ onOpenPath }: { onOpenPath: (path: string, kind: DriveTrashEntry["kind"]) => void }) {
  const { t } = useTranslation();
  const trash = useDriveTrash();
  const entries = trash.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <main className="min-h-0 overflow-y-auto p-5">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-[var(--text)]">{t("drive.trash")}</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t("drive.trashDescription")}</p>
      </div>
      {!trash.isLoading && entries.length === 0 && (
        <div className="rounded-md border border-dashed border-[var(--border)] py-16 text-center text-sm text-[var(--text-faint)]">
          {t("drive.trashEmpty")}
        </div>
      )}
      <div className="space-y-2">
        {entries.map((entry) => (
          <TrashRow key={entry.id} entry={entry} onOpenPath={onOpenPath} />
        ))}
      </div>
      {trash.hasNextPage && (
        <button
          type="button"
          disabled={trash.isFetchingNextPage}
          onClick={() => void trash.fetchNextPage()}
          className="mt-4 w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {t("common.showMore")}
        </button>
      )}
    </main>
  );
}

function TrashRow({
  entry,
  onOpenPath,
}: {
  entry: DriveTrashEntry;
  onOpenPath: (path: string, kind: DriveTrashEntry["kind"]) => void;
}) {
  const { t } = useTranslation();
  const restore = useRestoreDriveTrash();
  const purge = usePurgeDriveTrash();
  const [restoreKey] = useState(createUuid);
  const [purgeKey] = useState(createUuid);

  return (
    <article className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start gap-3">
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-faint)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">{entry.originalPath}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {entry.kind} · {formatBytes(entry.size)} · {formatDate(entry.deletedAt)}
          </div>
          {(restore.isError || purge.isError) && (
            <p role="alert" className="mt-2 text-xs text-[var(--status-error)]">{t("drive.trashActionFailed")}</p>
          )}
        </div>
        <button
          type="button"
          disabled={restore.isPending || purge.isPending}
          onClick={() =>
            restore.mutate({
              id: entry.id,
              idempotencyKey: restoreKey,
              expectedLifecycleRevision: entry.lifecycleRevision,
            }, {
              onSuccess: (result) => onOpenPath(result.restoredPath, entry.kind),
            })
          }
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] disabled:opacity-50"
          title={t("drive.restore")}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={restore.isPending || purge.isPending}
          onClick={() => {
            if (window.confirm(t("drive.purgeConfirm"))) {
              purge.mutate({
                id: entry.id,
                idempotencyKey: purgeKey,
                expectedLifecycleRevision: entry.lifecycleRevision,
              });
            }
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:opacity-50"
          title={t("drive.purge")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
