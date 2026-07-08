import { ChevronRight, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useKnowledgeBreadcrumb } from "@/features/knowledge/api";
import { cn } from "@/lib/utils";
import type { KnowledgeNodeType } from "@/types/knowledge";

interface BreadcrumbProps {
  articleId: string;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
}

export function Breadcrumb({ articleId, onSelect }: BreadcrumbProps) {
  const { t } = useTranslation();
  const { data } = useKnowledgeBreadcrumb(articleId);
  const items = data?.breadcrumb ?? [];

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
      <button
        onClick={() => onSelect("", undefined)}
        className="flex items-center transition-colors hover:text-[var(--text)]"
        title={t("knowledge.title")}
      >
        <Home size={12} />
      </button>
      {items.map((item, i) => (
        <span key={item.id} className="flex items-center gap-1">
          <ChevronRight size={11} className="text-[var(--text-faint)]" />
          <button
            onClick={() => onSelect(item.id, item.nodeType as KnowledgeNodeType)}
            className={cn(
              "truncate transition-colors hover:text-[var(--text)]",
              i === items.length - 1 && "text-[var(--text-muted)]",
            )}
          >
            {item.title}
          </button>
        </span>
      ))}
    </div>
  );
}
