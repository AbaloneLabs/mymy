import { useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FolderPlus,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import { DriveEntryGroup } from "@/features/drive/components/DriveEntryGroup";
import { DriveFileViewer } from "@/features/drive/components/DriveFileViewer";
import { LoadingLine, StatusPill } from "@/features/drive/components/DriveStatus";
import {
  previewUrl,
  drivePackageUrl,
  useCreateDriveFolder,
  useCreatePreviewEndpoint,
  useDeleteDrivePath,
  useDeletePreviewEndpoint,
  useDriveFile,
  useDriveList,
  useDriveProviders,
  useDriveSyncJobs,
  useDriveTrash,
  usePurgeDriveTrash,
  usePreviewEndpoints,
  useRestoreDriveTrash,
  useUploadDriveFiles,
} from "@/features/drive/api";
import {
  ROOT_PATH,
  buildBreadcrumbs,
  formatBytes,
  formatDate,
  parentPath,
} from "@/features/drive/utils";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type { DriveEntry } from "@/types/drive";

export default function DrivePage() {
  const { t } = useTranslation();
  const selectedAgentProfile = useProjectContext((s) => s.selectedAgentProfile);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState(ROOT_PATH);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [previewAgent, setPreviewAgent] = useState(selectedAgentProfile ?? "");
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewTarget, setPreviewTarget] = useState("http://127.0.0.1:5173");

  const list = useDriveList(path);
  const file = useDriveFile(selectedFilePath);
  const providers = useDriveProviders();
  const trash = useDriveTrash();
  const syncJobs = useDriveSyncJobs();
  const previews = usePreviewEndpoints(selectedAgentProfile);
  const agents = useAgents();
  const createFolder = useCreateDriveFolder();
  const deletePath = useDeleteDrivePath();
  const uploadFiles = useUploadDriveFiles();
  const restoreTrash = useRestoreDriveTrash();
  const purgeTrash = usePurgeDriveTrash();
  const createPreview = useCreatePreviewEndpoint();
  const deletePreview = useDeletePreviewEndpoint();

  const entries = list.data?.entries ?? [];
  const folders = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "file");
  const breadcrumbs = useMemo(() => buildBreadcrumbs(path), [path]);
  const selectedFile = file.data ?? null;

  function confirmDiscardEditorChanges() {
    return !editorDirty || window.confirm(t("documentEditor.discardConfirm"));
  }

  function selectPath(nextPath: string) {
    if (nextPath === path) return;
    if (!confirmDiscardEditorChanges()) return;
    setPath(nextPath);
    setSelectedFilePath(null);
    setEditorDirty(false);
  }

  function openEntry(entry: DriveEntry) {
    if (entry.kind === "directory") {
      if (!confirmDiscardEditorChanges()) return;
      setPath(entry.path);
      setSelectedFilePath(null);
      setEditorDirty(false);
      return;
    }
    if (entry.path !== selectedFilePath && !confirmDiscardEditorChanges()) return;
    setSelectedFilePath(entry.path);
    setEditorDirty(false);
  }

  function openDocumentPath(targetPath: string) {
    if (targetPath !== selectedFilePath && !confirmDiscardEditorChanges()) return;
    setPath(parentPath(targetPath));
    setSelectedFilePath(targetPath);
    setEditorDirty(false);
  }

  function goUp() {
    if (path === ROOT_PATH) return;
    if (!confirmDiscardEditorChanges()) return;
    setPath(parentPath(path));
    setSelectedFilePath(null);
    setEditorDirty(false);
  }

  function closeSelectedFile() {
    if (!confirmDiscardEditorChanges()) return;
    setSelectedFilePath(null);
    setEditorDirty(false);
  }

  function handleCreateFolder() {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, "");
    if (!name) return;
    createFolder.mutate(`${path}/${name}`.replace("//", "/"), {
      onSuccess: () => setNewFolderName(""),
    });
  }

  function handleDelete(targetPath: string) {
    if (!window.confirm(t("drive.deleteConfirm"))) return;
    deletePath.mutate(targetPath, {
      onSuccess: () => {
        if (selectedFilePath === targetPath) setSelectedFilePath(null);
        if (selectedFilePath === targetPath) setEditorDirty(false);
      },
    });
  }

  function handleUpload(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    uploadFiles.mutate({ path, files: selected });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleCreatePreview() {
    const agentProfile = previewAgent.trim() || selectedAgentProfile || "";
    if (!agentProfile || !previewLabel.trim() || !previewTarget.trim()) return;
    createPreview.mutate(
      {
        agentProfile,
        label: previewLabel.trim(),
        targetUrl: previewTarget.trim(),
        visibility: "session",
      },
      {
        onSuccess: () => setPreviewLabel(""),
      },
    );
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
            <h1 className="text-lg font-semibold">{t("drive.title")}</h1>
          </div>
          <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm text-[var(--text-muted)]">
            {breadcrumbs.map((crumb, index) => (
              <button
                key={crumb.path}
                type="button"
                onClick={() => selectPath(crumb.path)}
                className={cn(
                  "truncate rounded px-1.5 py-1 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  index === breadcrumbs.length - 1 && "text-[var(--text)]"
                )}
              >
                {crumb.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => list.refetch()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            title={t("common.refresh", { defaultValue: "Refresh" })}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => handleUpload(event.currentTarget.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadFiles.isPending}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t("drive.upload")}
          >
            {uploadFiles.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_320px] overflow-hidden">
          <section className="flex min-h-0 flex-col border-r border-[var(--border)]">
            <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
              <button
                type="button"
                onClick={goUp}
                disabled={path === ROOT_PATH}
                className="h-8 rounded-md border border-[var(--border)] px-2 text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                ..
              </button>
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCreateFolder();
                }}
                placeholder={t("drive.newFolder")}
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || createFolder.isPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-white disabled:cursor-not-allowed disabled:opacity-50"
                title={t("drive.createFolder")}
              >
                {createFolder.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
              {list.isLoading && <LoadingLine label={t("common.loading")} />}
              {!list.isLoading && entries.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-[var(--text-faint)]">
                  {t("drive.empty")}
                </p>
              )}
              <DriveEntryGroup entries={folders} selectedFilePath={selectedFilePath} onOpen={openEntry} onDelete={handleDelete} />
              <DriveEntryGroup entries={files} selectedFilePath={selectedFilePath} onOpen={openEntry} onDelete={handleDelete} />
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="flex h-12 items-center gap-2 border-b border-[var(--border)] px-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text)]">
                  {selectedFile?.name ?? t("drive.noSelection")}
                </p>
                {selectedFile && (
                  <p className="truncate text-xs text-[var(--text-faint)]">
                    {selectedFile.mimeType} · {formatBytes(selectedFile.size)}
                  </p>
                )}
              </div>
              {selectedFile && (
                <>
                  <a
                    href={drivePackageUrl(selectedFile.path)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    title={t("drive.downloadPackage")}
                  >
                    <Download className="h-4 w-4" strokeWidth={1.75} />
                  </a>
                  <button
                    type="button"
                    onClick={closeSelectedFile}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    title={t("common.close")}
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </>
              )}
            </div>
            <div
              className={cn(
                "min-h-0 flex-1",
                selectedFile && selectedFile.editorKind !== "preview"
                  ? "overflow-hidden"
                  : "overflow-auto p-4",
              )}
            >
              {file.isLoading && <LoadingLine label={t("common.loading")} />}
              {!file.isLoading && (
                <DriveFileViewer
                  file={selectedFile}
                  onCloseEditor={closeSelectedFile}
                  onDirtyChange={setEditorDirty}
                  onOpenDocument={openDocumentPath}
                />
              )}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-[var(--border)] p-4">
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t("drive.providers")}</h2>
              <div className="space-y-2">
                {(providers.data?.providers ?? []).map((provider) => (
                  <div key={provider.provider} className="rounded-md border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{provider.provider}</span>
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        provider.configured
                          ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
                          : "bg-[var(--surface-muted)] text-[var(--text-faint)]"
                      )}>
                        {provider.configured ? t("drive.configured") : t("drive.notConfigured")}
                      </span>
                    </div>
                    {(provider.bucket || provider.region || provider.endpoint) && (
                      <p className="mt-2 break-all text-xs text-[var(--text-muted)]">
                        {[provider.bucket, provider.region, provider.endpoint].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("drive.trash")}</h2>
                <button
                  type="button"
                  onClick={() => trash.refetch()}
                  className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  title={t("common.refresh")}
                >
                  <RefreshCw className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <div className="space-y-2">
                {(trash.data?.entries ?? []).slice(0, 6).map((entry) => (
                  <div key={entry.id} className="rounded-md border border-[var(--border)] p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text)]">
                          {entry.originalPath}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {formatBytes(entry.size)} · {formatDate(entry.deletedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreTrash.mutate(entry.id)}
                        disabled={restoreTrash.isPending}
                        className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                        title={t("drive.restore")}
                      >
                        <RotateCcw className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        onClick={() => purgeTrash.mutate(entry.id)}
                        disabled={purgeTrash.isPending}
                        className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
                        title={t("drive.purge")}
                      >
                        <Trash2 className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ))}
                {!trash.isLoading && (trash.data?.entries ?? []).length === 0 && (
                  <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
                    {t("drive.trashEmpty")}
                  </p>
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("drive.syncJobs")}</h2>
                <button
                  type="button"
                  onClick={() => syncJobs.refetch()}
                  className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  title={t("common.refresh")}
                >
                  <RefreshCw className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <div className="space-y-2">
                {(syncJobs.data?.jobs ?? []).slice(0, 6).map((job) => (
                  <div key={job.id} className="rounded-md border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[var(--text)]">
                        {job.operation}
                      </span>
                      <StatusPill status={job.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                      {job.drivePath}
                    </p>
                    {job.error && (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--status-error)]">
                        {job.error}
                      </p>
                    )}
                  </div>
                ))}
                {!syncJobs.isLoading && (syncJobs.data?.jobs ?? []).length === 0 && (
                  <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
                    {t("drive.syncEmpty")}
                  </p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold">{t("drive.previews")}</h2>
              <div className="space-y-2">
                <select
                  value={previewAgent || selectedAgentProfile || ""}
                  onChange={(event) => setPreviewAgent(event.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                >
                  <option value="">{t("drive.selectAgent")}</option>
                  {(agents.data?.agents ?? []).map((agent) => (
                    <option key={agent.profile} value={agent.profile}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <input
                  value={previewLabel}
                  onChange={(event) => setPreviewLabel(event.target.value)}
                  placeholder={t("drive.previewLabel")}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                />
                <input
                  value={previewTarget}
                  onChange={(event) => setPreviewTarget(event.target.value)}
                  placeholder="http://127.0.0.1:5173"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleCreatePreview}
                  disabled={!(previewAgent || selectedAgentProfile) || !previewLabel.trim() || !previewTarget.trim() || createPreview.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                  {t("drive.addPreview")}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {(previews.data?.previews ?? []).map((preview) => (
                  <div key={preview.id} className="rounded-md border border-[var(--border)] p-3">
                    <div className="flex items-center gap-2">
                      <a
                        href={previewUrl(preview.token)}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--accent)] hover:underline"
                      >
                        {preview.label}
                      </a>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.5} />
                      <button
                        type="button"
                        onClick={() => deletePreview.mutate(preview.id)}
                        className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
                        title={t("common.delete")}
                      >
                        <Trash2 className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{preview.targetUrl}</p>
                  </div>
                ))}
                {!previews.isLoading && (previews.data?.previews ?? []).length === 0 && (
                  <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
                    {t("drive.noPreviews")}
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
