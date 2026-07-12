import { FolderPlus, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveEntry } from "@/types/drive";
import { ROOT_PATH } from "@/features/drive/utils";
import { DriveEntryGroup } from "./DriveEntryGroup";
import { LoadingLine } from "./DriveStatus";

export function DriveBrowserPane({
  path,
  entries,
  selectedFilePath,
  isLoading,
  newFolderName,
  createFolderPending,
  onNewFolderNameChange,
  onGoUp,
  onCreateFolder,
  onOpenEntry,
  onDeleteEntry,
  trashActive,
  trashCount,
  trashCountFailed,
  onOpenTrash,
}: {
  path: string;
  entries: DriveEntry[];
  selectedFilePath: string | null;
  isLoading: boolean;
  newFolderName: string;
  createFolderPending: boolean;
  onNewFolderNameChange: (value: string) => void;
  onGoUp: () => void;
  onCreateFolder: () => void;
  onOpenEntry: (entry: DriveEntry) => void;
  onDeleteEntry: (path: string) => void;
  trashActive: boolean;
  trashCount: number | undefined;
  trashCountFailed: boolean;
  onOpenTrash: () => void;
}) {
  const { t } = useTranslation();
  const folders = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "file");

  return (
    <section className="flex min-h-0 flex-col border-r border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button
          type="button"
          onClick={onGoUp}
          disabled={path === ROOT_PATH}
          className="h-8 rounded-md border border-[var(--border)] px-2 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ..
        </button>
        <input
          value={newFolderName}
          onChange={(event) => onNewFolderNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreateFolder();
          }}
          placeholder={t("drive.newFolder")}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={onCreateFolder}
          disabled={!newFolderName.trim() || createFolderPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-white disabled:cursor-not-allowed disabled:opacity-50"
          title={t("drive.createFolder")}
        >
          {createFolderPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {isLoading && <LoadingLine label={t("common.loading")} />}
        {!isLoading && entries.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-[var(--text-faint)]">
            {t("drive.empty")}
          </p>
        )}
        <DriveEntryGroup
          entries={folders}
          selectedFilePath={selectedFilePath}
          onOpen={onOpenEntry}
          onDelete={onDeleteEntry}
        />
        <DriveEntryGroup
          entries={files}
          selectedFilePath={selectedFilePath}
          onOpen={onOpenEntry}
          onDelete={onDeleteEntry}
        />
      </div>
      <button
        type="button"
        aria-current={trashActive ? "page" : undefined}
        onClick={onOpenTrash}
        className={`flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-3 py-3 text-sm ${
          trashActive
            ? "bg-[var(--surface-hover)] text-[var(--text)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        }`}
      >
        <Trash2 className="h-4 w-4" />
        <span className="flex-1 text-left">{t("drive.trash")}</span>
        {trashCountFailed ? (
          <span className="text-[10px] text-[var(--status-warning)]">!</span>
        ) : trashCount !== undefined ? (
          <span className="rounded-full bg-[var(--surface-muted)] px-1.5 text-[10px]">
            {trashCount > 99 ? "99+" : trashCount}
          </span>
        ) : null}
      </button>
    </section>
  );
}
