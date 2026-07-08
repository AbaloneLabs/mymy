import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { CodeBlock } from "../shared/codeHighlight";
import { languageFromTitle } from "../shared/codeLanguage";
import type {
  FileMutationResult,
  ReadFileResult,
  SearchFilesResult,
} from "./toolResultGeneralParsers";
import {
  isDocumentEditorPath,
  isHtmlPreviewPath,
} from "./toolResultGeneralParsers";
import {
  ExpandableFooter,
  MiniMeta,
  ToolPanelHeader,
} from "./toolResultShared";

export function ReadFileResultPanel({
  result,
  status,
}: {
  result: ReadFileResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const range =
    result.shownStart !== undefined && result.shownEnd !== undefined
      ? `${result.shownStart}-${result.shownEnd}`
      : undefined;
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="file"
        title={t("chat.readFileTitle")}
        status={status}
        meta={range ? t("chat.lineRange", { range }) : undefined}
      />
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
        {result.path}
      </div>
      {result.content && (
        <CodeBlock
          title={result.path.split("/").pop() || "file.txt"}
          content={result.content}
          language={languageFromTitle(result.path)}
        />
      )}
      {result.totalLines !== undefined && (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("chat.totalLines", { count: result.totalLines })}
        </div>
      )}
    </div>
  );
}

export function SearchFilesResultPanel({
  result,
  status,
}: {
  result: SearchFilesResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleMatches = expanded ? result.matches : result.matches.slice(0, 6);
  const hiddenCount = Math.max(result.matches.length - visibleMatches.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="search"
        title={t("chat.fileSearchTitle")}
        status={status}
        meta={t("chat.fileSearchCount", { count: result.matches.length })}
      />
      {result.matches.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {t("chat.noMatches")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2">
          {visibleMatches.map((match, index) => (
            <div
              key={`${match.path}:${match.line ?? index}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="truncate font-mono text-[10px] text-[var(--text-faint)]">
                {match.path}
                {match.line !== undefined ? `:${match.line}` : ""}
              </div>
              {match.preview && (
                <div className="mt-1 break-words font-mono text-[11px] text-[var(--text)]">
                  {match.preview}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ExpandableFooter
        expanded={expanded}
        hiddenCount={hiddenCount}
        onToggle={() => setExpanded((current) => !current)}
      />
    </div>
  );
}

export function FileMutationResultPanel({
  name,
  result,
  status,
  onOpenDocument,
}: {
  name: string;
  result: FileMutationResult;
  status: "running" | "done";
  onOpenDocument?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const htmlPreview = isHtmlPreviewPath(result.path);
  const canOpen =
    status === "done" &&
    (isDocumentEditorPath(result.path) || htmlPreview) &&
    onOpenDocument;
  const content = (
    <>
      <ToolPanelHeader
        icon="file"
        title={name === "patch_file" ? t("chat.patchFileTitle") : t("chat.writeFileTitle")}
        status={status}
        ok
      />
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
        {result.path}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {result.bytesWritten !== undefined && (
          <MiniMeta value={`${result.bytesWritten} bytes`} />
        )}
        {result.linesWritten !== undefined && (
          <MiniMeta value={`${result.linesWritten} lines`} />
        )}
        {result.replacements !== undefined && (
          <MiniMeta value={`${result.replacements} replacement`} />
        )}
        {canOpen && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--accent)]">
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            {htmlPreview ? t("chat.openPreview") : t("chat.openEditor")}
          </span>
        )}
      </div>
    </>
  );

  if (canOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpenDocument(result.path)}
        className="block max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-hover)]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      {content}
    </div>
  );
}
