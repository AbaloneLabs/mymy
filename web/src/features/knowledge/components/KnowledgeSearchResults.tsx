import { FileText, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  KnowledgeArticle,
  KnowledgeNodeType,
} from "@/types/knowledge";

export function SearchResultList({
  results,
  selectedId,
  onSelect,
  emptyText,
}: {
  results: KnowledgeArticle[];
  selectedId: string | null;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
  emptyText: string;
}) {
  const { t } = useTranslation();
  if (results.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-[var(--text-dim)]">
        {emptyText}
      </div>
    );
  }
  return (
    <ul className="space-y-0.5">
      {results.map((article) => (
        <li key={article.id}>
          <button
            onClick={() => onSelect(article.id, article.nodeType)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
              selectedId === article.id
                ? "bg-[var(--surface-hover)]"
                : "hover:bg-[var(--surface-hover)]",
            )}
          >
            {article.nodeType === "category" ? (
              <Folder size={14} className="mt-0.5 shrink-0 text-[var(--text-dim)]" />
            ) : (
              <FileText size={14} className="mt-0.5 shrink-0 text-[var(--text-dim)]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--text)]">
                {article.title}
              </div>
              <div className="truncate text-xs text-[var(--text-dim)]">
                {article.excerpt || article.content.slice(0, 60) || t("knowledge.noContent")}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
