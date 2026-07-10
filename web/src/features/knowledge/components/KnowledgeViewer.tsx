import { FolderOpen, History as HistoryIcon, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type {
  KnowledgeArticle,
  KnowledgeNodeType,
} from "@/types/knowledge";
import { Breadcrumb } from "./KnowledgeBreadcrumb";
import { KnowledgeResourcesPanel } from "./KnowledgeResourcesPanel";

export function Viewer({
  article,
  onEdit,
  onDelete,
  deleting,
  onSelect,
  onShowHistory,
}: {
  article: KnowledgeArticle;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
  onShowHistory: () => void;
}) {
  const { t } = useTranslation();
  const isDraft = article.status === "draft";
  const isCategory = article.nodeType === "category";

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-6 py-3">
        <div className="min-w-0 flex-1">
          <Breadcrumb articleId={article.id} onSelect={onSelect} />
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-[var(--text)]">
              {article.title}
            </h1>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                isDraft
                  ? "bg-[var(--surface)] text-[var(--text-faint)]"
                  : "bg-[var(--status-active)]/10 text-[var(--status-active)]",
              )}
            >
              {isDraft ? t("knowledge.status.draft") : t("knowledge.status.published")}
            </span>
          </div>
          {article.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onShowHistory}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("notes.versionHistory")}
        >
          <HistoryIcon size={15} />
        </button>
        <button
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("knowledge.edit")}
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:opacity-50"
          title={t("knowledge.delete")}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {isCategory ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-1 text-sm text-[var(--text-dim)]">
            <FolderOpen size={28} className="mb-2 text-[var(--text-faint)]" />
            <span className="font-medium text-[var(--text-muted)]">{article.title}</span>
            <span>{t("knowledge.folderSelected")}</span>
          </div>
        ) : article.content ? (
          <div className="knowledge-prose mx-auto max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
            {t("knowledge.noContent")}
          </div>
        )}
        <KnowledgeResourcesPanel knowledgeId={article.id} />
      </div>
    </>
  );
}
