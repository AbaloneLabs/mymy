import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { drivePackageUrl } from "@/features/drive/api";
import { formatBytes } from "@/features/drive/utils";
import { cn } from "@/lib/utils";
import type { DriveFileResponse } from "@/types/drive";
import { DriveFileViewer } from "./DriveFileViewer";
import { LoadingLine } from "./DriveStatus";

export function DriveFilePane({
  selectedFile,
  isLoading,
  onCloseSelectedFile,
  onDirtyChange,
  onOpenDocument,
}: {
  selectedFile: DriveFileResponse | null;
  isLoading: boolean;
  onCloseSelectedFile: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenDocument: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
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
              onClick={onCloseSelectedFile}
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
        {isLoading && <LoadingLine label={t("common.loading")} />}
        {!isLoading && (
          <DriveFileViewer
            file={selectedFile}
            onCloseEditor={onCloseSelectedFile}
            onDirtyChange={onDirtyChange}
            onOpenDocument={onOpenDocument}
          />
        )}
      </div>
    </section>
  );
}
