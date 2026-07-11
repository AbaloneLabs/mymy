import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  useCreateDriveFolder,
  useDeleteDrivePath,
  useDriveFile,
  useDriveList,
  useUploadDriveFiles,
} from "@/features/drive/api";
import {
  ROOT_PATH,
  buildBreadcrumbs,
  parentPath,
} from "@/features/drive/utils";
import { useProjectContext } from "@/store/projectContext";
import type { DriveEntry } from "@/types/drive";
import { DriveBrowserPane } from "./DriveBrowserPane";
import { DriveFilePane } from "./DriveFilePane";
import { DriveHeader } from "./DriveHeader";
import { DriveSidePanel } from "./DriveSidePanel";

export function DriveView() {
  const { t } = useTranslation();
  const selectedAgentProfile = useProjectContext((s) => s.selectedAgentProfile);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchParams] = useSearchParams();
  const linkedFile = searchParams.get("file");
  const initialFile = linkedFile?.startsWith("/drive/") ? linkedFile : null;
  const [path, setPath] = useState(() =>
    initialFile ? parentPath(initialFile) : ROOT_PATH,
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialFile);
  const [editorDirty, setEditorDirty] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadNotice, setUploadNotice] = useState<string>();

  const list = useDriveList(path);
  const file = useDriveFile(selectedFilePath);
  const createFolder = useCreateDriveFolder();
  const deletePath = useDeleteDrivePath();
  const uploadFiles = useUploadDriveFiles();

  const entries = list.data?.entries ?? [];
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
    setUploadNotice(undefined);
    uploadFiles.mutate(
      { path, files: selected },
      {
        onSuccess: (response) => {
          const committed = response.results.filter(
            (result) => result.outcome === "committed",
          ).length;
          const quarantined = response.results.filter(
            (result) => result.outcome === "quarantined",
          ).length;
          const rejected = response.results.filter(
            (result) => result.outcome === "rejected",
          ).length;
          setUploadNotice(
            t("drive.uploadResult", { committed, quarantined, rejected }),
          );
        },
        onError: () => setUploadNotice(t("drive.uploadFailed")),
      },
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full flex-col">
      <DriveHeader
        breadcrumbs={breadcrumbs}
        fileInputRef={fileInputRef}
        uploading={uploadFiles.isPending}
        onRefresh={() => void list.refetch()}
        onSelectPath={selectPath}
        onUpload={handleUpload}
      />

      {uploadNotice && (
        <div
          role="status"
          className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-6 py-2 text-xs text-[var(--text-secondary)]"
        >
          {uploadNotice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_320px] overflow-hidden">
        <DriveBrowserPane
          path={path}
          entries={entries}
          selectedFilePath={selectedFilePath}
          isLoading={list.isLoading}
          newFolderName={newFolderName}
          createFolderPending={createFolder.isPending}
          onNewFolderNameChange={setNewFolderName}
          onGoUp={goUp}
          onCreateFolder={handleCreateFolder}
          onOpenEntry={openEntry}
          onDeleteEntry={handleDelete}
        />

        <DriveFilePane
          selectedFile={selectedFile}
          isLoading={file.isLoading}
          onCloseSelectedFile={closeSelectedFile}
          onDirtyChange={setEditorDirty}
          onOpenDocument={openDocumentPath}
        />

        <DriveSidePanel selectedAgentProfile={selectedAgentProfile} />
      </div>
    </div>
  );
}
