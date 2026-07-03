import {
  File,
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Trash2,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DriveEntry } from "@/types/drive";
import { formatBytes } from "../utils";

export function DriveEntryGroup({
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
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(entry)}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
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

function iconForEntry(entry: DriveEntry) {
  if (entry.mimeType.startsWith("image/")) return ImageIcon;
  if (entry.mimeType.startsWith("video/")) return Video;
  if (entry.mimeType.startsWith("audio/")) return Music;
  if (entry.mimeType.startsWith("text/") || entry.name.endsWith(".md")) {
    return FileText;
  }
  return File;
}
