import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  driveBlobUrl,
  useWriteDriveFile,
} from "@/features/drive/api";
import { cn } from "@/lib/utils";
import type { DriveFileResponse } from "@/types/drive";

export function DriveFileViewer({ file }: { file: DriveFileResponse | null }) {
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
  if (file.mimeType.includes("wordprocessingml.document")) {
    return (
      <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
        {file.content}
      </pre>
    );
  }
  if (file.editable) {
    return (
      <EditableFileViewer
        key={`${file.path}:${file.updatedAt ?? ""}`}
        file={file}
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
      <div
        className={cn(
          "grid min-h-full flex-1 gap-4",
          markdown ? "grid-cols-2" : "grid-cols-1",
        )}
      >
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
