import type { RefObject } from "react";
import { HardDrive, Loader2, RefreshCw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function DriveHeader({
  breadcrumbs,
  fileInputRef,
  uploading,
  onRefresh,
  onSelectPath,
  onUpload,
}: {
  breadcrumbs: { path: string; label: string }[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploading: boolean;
  onRefresh: () => void;
  onSelectPath: (path: string) => void;
  onUpload: (files: FileList | null) => void;
}) {
  const { t } = useTranslation();

  return (
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
            onClick={() => onSelectPath(crumb.path)}
            className={cn(
              "truncate rounded px-1.5 py-1 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              index === breadcrumbs.length - 1 && "text-[var(--text)]",
            )}
          >
            {crumb.label}
          </button>
        ))}
      </nav>
      <button
        type="button"
        onClick={onRefresh}
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
        onChange={(event) => onUpload(event.currentTarget.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        title={t("drive.upload")}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Upload className="h-4 w-4" strokeWidth={1.5} />
        )}
      </button>
    </header>
  );
}
