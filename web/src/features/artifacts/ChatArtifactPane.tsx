import { FileText, FolderOpen, Loader2, PackageOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useOpenArtifact, useSessionArtifacts } from "./api";

export function ChatArtifactPane({
  sessionId,
  collapsed,
  onOpenDocument,
  onOpenHtml,
}: {
  sessionId: string | null;
  collapsed: boolean;
  onOpenDocument: (path: string) => void;
  onOpenHtml: (path: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useSessionArtifacts(sessionId);
  const open = useOpenArtifact();
  const artifacts = query.data?.pages.flatMap((page) => page.artifacts) ?? [];

  if (collapsed) {
    return (
      <div
        className="flex h-10 items-center justify-center border-t border-[var(--border)] text-[var(--text-faint)]"
        title={t("artifacts.count", { count: artifacts.length })}
        aria-label={t("artifacts.count", { count: artifacts.length })}
      >
        <PackageOpen className="h-4 w-4" />
        {artifacts.length > 0 && <span className="ml-1 text-[9px]">{artifacts.length > 99 ? "99+" : artifacts.length}</span>}
      </div>
    );
  }

  async function openArtifact(id: string) {
    const resolved = await open.mutateAsync(id);
    if (isEditableDocument(resolved.path)) onOpenDocument(resolved.path);
    else if (/\.html?$/i.test(resolved.path)) onOpenHtml(resolved.path);
    else navigate(`/drive?path=${encodeURIComponent(resolved.path)}`);
  }

  return (
    <section className="flex min-h-0 basis-2/5 flex-col border-t border-[var(--border)]">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {t("artifacts.title")}
        </h2>
        <span className="text-[10px] text-[var(--text-faint)]">{artifacts.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {query.isLoading && <Loader2 className="mx-auto mt-4 h-4 w-4 animate-spin text-[var(--text-faint)]" />}
        {!query.isLoading && artifacts.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-[var(--text-faint)]">{t("artifacts.empty")}</p>
        )}
        {artifacts.map((artifact) => {
          const active = artifact.lifecycleState === "active";
          return (
            <div
              key={artifact.id}
              className="rounded-md px-2 py-2 hover:bg-[var(--surface-hover)]"
            >
              <button
                type="button"
                disabled={!active || open.isPending}
                onClick={() => void openArtifact(artifact.id)}
                className="flex w-full items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-[var(--text)]">{artifact.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-1 text-[10px] text-[var(--text-faint)]">
                    <span>{t(`artifacts.relationship.${artifact.relationshipKind}`)}</span>
                    <span>·</span>
                    <span>{t(`artifacts.lifecycle.${artifact.lifecycleState}`)}</span>
                    {artifact.producingAgent && <span>· {artifact.producingAgent}</span>}
                  </div>
                  {artifact.currentPath && <div className="mt-0.5 truncate font-mono text-[9px] text-[var(--text-faint)]">{artifact.currentPath}</div>}
                </div>
              </button>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[9px]">
                {artifact.currentPath && (
                  <button
                    type="button"
                    onClick={() => navigate(`/drive?path=${encodeURIComponent(artifact.currentPath!)}`)}
                    className="inline-flex min-w-0 items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t("artifacts.driveLocation")}</span>
                  </button>
                )}
                {artifact.wikiLinks.slice(0, 3).map((link) => (
                  <button
                    key={link.knowledgeId}
                    type="button"
                    onClick={() => navigate(`/knowledge?id=${encodeURIComponent(link.knowledgeId)}`)}
                    className="max-w-full truncate text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    {link.title}
                  </button>
                ))}
                {artifact.wikiLinks.length > 3 && (
                  <span className="text-[var(--text-faint)]">
                    {t("artifacts.moreWikiLinks", { count: artifact.wikiLinks.length - 3 })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {query.hasNextPage && (
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="w-full py-2 text-[10px] text-[var(--text-muted)]"
          >
            {t("artifacts.loadMore")}
          </button>
        )}
      </div>
    </section>
  );
}

function isEditableDocument(path: string) {
  return /\.(md|markdown|txt|csv|tsv|json|yaml|yml|docx|xlsx|pptx)$/i.test(path);
}
