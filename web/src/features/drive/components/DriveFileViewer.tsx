import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { driveBlobUrl } from "@/features/drive/api";
import { DocumentEditorPane } from "@/features/documentEditor/DocumentEditorPane";
import { LightweightBrowserPane } from "./LightweightBrowserPane";
import type { DriveFileResponse } from "@/types/drive";

export function DriveFileViewer({
  file,
  onCloseEditor,
  onDirtyChange,
  onOpenDocument,
}: {
  file: DriveFileResponse | null;
  onCloseEditor?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenDocument?: (path: string) => void;
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
  if (isHtmlFile(file)) {
    return <LightweightBrowserPane path={file.path} />;
  }
  if (file.mimeType.startsWith("image/")) {
    return (
      <img
        src={blobUrl}
        alt={file.name}
        className="max-h-full max-w-full rounded-md object-contain"
      />
    );
  }
  if (file.mimeType.startsWith("video/")) {
    return (
      <video src={blobUrl} controls className="max-h-full w-full rounded-md bg-black" />
    );
  }
  if (file.mimeType.startsWith("audio/")) {
    return <audio src={blobUrl} controls className="w-full" />;
  }
  if (file.mimeType === "application/pdf") {
    return (
      <iframe
        src={blobUrl}
        title={file.name}
        className="h-full min-h-[640px] w-full rounded-md border border-[var(--border)]"
      />
    );
  }
  if (file.editorKind !== "preview") {
    return (
      <DocumentEditorPane
        key={file.path}
        path={file.path}
        onClose={onCloseEditor ?? (() => undefined)}
        onDirtyChange={onDirtyChange}
        onOpenDocument={onOpenDocument}
        variant="embedded"
      />
    );
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

function isHtmlFile(file: DriveFileResponse) {
  const name = file.name.toLowerCase();
  return (
    file.mimeType === "text/html" ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  );
}
