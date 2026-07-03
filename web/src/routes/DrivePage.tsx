import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import {
  driveBlobUrl,
  previewUrl,
  useCreateDriveFolder,
  useCreatePreviewEndpoint,
  useDeleteDrivePath,
  useDeletePreviewEndpoint,
  useDriveFile,
  useDriveList,
  useDriveProviders,
  usePreviewEndpoints,
  useWriteDriveFile,
} from "@/features/drive/api";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type { DriveEntry, DriveFileResponse } from "@/types/drive";

const ROOT_PATH = "/drive";

export default function DrivePage() {
  const { t } = useTranslation();
  const selectedAgentProfile = useProjectContext((s) => s.selectedAgentProfile);
  const [path, setPath] = useState(ROOT_PATH);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [previewAgent, setPreviewAgent] = useState(selectedAgentProfile ?? "");
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewTarget, setPreviewTarget] = useState("http://127.0.0.1:5173");

  const list = useDriveList(path);
  const file = useDriveFile(selectedFilePath);
  const providers = useDriveProviders();
  const previews = usePreviewEndpoints(selectedAgentProfile);
  const agents = useAgents();
  const createFolder = useCreateDriveFolder();
  const deletePath = useDeleteDrivePath();
  const createPreview = useCreatePreviewEndpoint();
  const deletePreview = useDeletePreviewEndpoint();

  const entries = list.data?.entries ?? [];
  const folders = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "file");
  const breadcrumbs = useMemo(() => buildBreadcrumbs(path), [path]);
  const selectedFile = file.data ?? null;

  function openEntry(entry: DriveEntry) {
    if (entry.kind === "directory") {
      setPath(entry.path);
      setSelectedFilePath(null);
      return;
    }
    setSelectedFilePath(entry.path);
  }

  function goUp() {
    if (path === ROOT_PATH) return;
    setPath(parentPath(path));
    setSelectedFilePath(null);
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
      },
    });
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
                onClick={() => {
                  setPath(crumb.path);
                  setSelectedFilePath(null);
                }}
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
              <EntryGroup entries={folders} selectedFilePath={selectedFilePath} onOpen={openEntry} onDelete={handleDelete} />
              <EntryGroup entries={files} selectedFilePath={selectedFilePath} onOpen={openEntry} onDelete={handleDelete} />
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
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {file.isLoading && <LoadingLine label={t("common.loading")} />}
              {!file.isLoading && <FileViewer file={selectedFile} />}
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

function EntryGroup({
  entries,
  selectedFilePath,
  onOpen,
  onDelete,
}: {
  entries: DriveEntry[];
  selectedFilePath: string | null;
  onOpen: (entry: DriveEntry) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => {
        const Icon = entry.kind === "directory" ? Folder : iconForEntry(entry);
        return (
          <div
            key={entry.path}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              selectedFilePath === entry.path
                ? "bg-[var(--surface-hover)] text-[var(--text)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            )}
          >
            <button type="button" onClick={() => onOpen(entry)} className="flex min-w-0 flex-1 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate text-left">{entry.name}</span>
            </button>
            {entry.kind === "file" && (
              <span className="hidden shrink-0 text-xs text-[var(--text-faint)] sm:inline">
                {formatBytes(entry.size)}
              </span>
            )}
            <button
              type="button"
              onClick={() => onDelete(entry.path)}
              className="h-7 w-7 rounded-md text-[var(--text-faint)] opacity-0 hover:bg-[var(--surface)] hover:text-[var(--status-error)] group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FileViewer({
  file,
}: {
  file: DriveFileResponse | null;
}) {
  const { t } = useTranslation();
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        {t("drive.noSelection")}
      </div>
    );
  }

  const blobUrl = driveBlobUrl(file.path);
  if (file.mimeType.startsWith("image/")) {
    return <img src={blobUrl} alt={file.name} className="max-h-full max-w-full rounded-md object-contain" />;
  }
  if (file.mimeType.startsWith("video/")) {
    return <video src={blobUrl} controls className="max-h-full w-full rounded-md bg-black" />;
  }
  if (file.mimeType.startsWith("audio/")) {
    return <audio src={blobUrl} controls className="w-full" />;
  }
  if (file.mimeType === "application/pdf") {
    return <iframe src={blobUrl} title={file.name} className="h-full min-h-[640px] w-full rounded-md border border-[var(--border)]" />;
  }
  if (file.mimeType.includes("wordprocessingml.document")) {
    return <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">{file.content}</pre>;
  }
  if (file.editable) {
    return <EditableFileViewer key={`${file.path}:${file.updatedAt ?? ""}`} file={file} />;
  }

  return (
    <a
      href={blobUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--surface-hover)]"
    >
      <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
      {t("drive.openFile")}
    </a>
  );
}

function EditableFileViewer({ file }: { file: DriveFileResponse }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(file.content);
  const writeFile = useWriteDriveFile();
  const markdown = file.mimeType === "text/markdown" || file.name.endsWith(".md");
  const dirty = draft !== file.content;

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => writeFile.mutate({ path: file.path, content: draft })}
          disabled={!dirty || writeFile.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {writeFile.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-4 w-4" strokeWidth={1.5} />
          )}
          {t("common.save")}
        </button>
      </div>
      <div className={cn("grid min-h-full flex-1 gap-4", markdown ? "grid-cols-2" : "grid-cols-1")}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          className="min-h-[640px] resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-sm leading-6 outline-none focus:border-[var(--accent)]"
        />
        {markdown && (
          <article className="prose prose-sm max-w-none rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-4 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
      {label}
    </div>
  );
}

function iconForEntry(entry: DriveEntry) {
  if (entry.mimeType.startsWith("image/")) return ImageIcon;
  if (entry.mimeType.startsWith("video/")) return Video;
  if (entry.mimeType.startsWith("audio/")) return Music;
  if (entry.mimeType.startsWith("text/") || entry.name.endsWith(".md")) return FileText;
  return File;
}

function buildBreadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "drive", path: ROOT_PATH }];
  let current = "";
  for (const part of parts.slice(1)) {
    current += `/${part}`;
    crumbs.push({ label: part, path: `${ROOT_PATH}${current}` });
  }
  return crumbs;
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return ROOT_PATH;
  return `/${parts.slice(0, -1).join("/")}`;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
