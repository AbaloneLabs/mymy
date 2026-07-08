import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import type { KnowledgeArticle } from "@/types/knowledge";
import type { KnowledgeArticleSnapshot } from "@/types/versions";

export function KnowledgeHistoryPanel({
  open,
  selectedId,
  selected,
  onClose,
  onRestore,
}: {
  open: boolean;
  selectedId: string | null;
  selected: KnowledgeArticle | null;
  onClose: () => void;
  onRestore: (snapshot: KnowledgeArticleSnapshot) => void;
}) {
  if (!open || !selectedId || !selected) return null;
  return (
    <VersionHistoryPanel
      entityType="knowledge_article"
      entityId={selectedId}
      current={
        {
          title: selected.title,
          slug: selected.slug,
          content: selected.content,
          excerpt: selected.excerpt,
          tags: selected.tags,
          status: selected.status,
          nodeType: selected.nodeType,
          parentId: selected.parentId,
          projectId: selected.projectId,
          sortOrder: selected.sortOrder,
        } as KnowledgeArticleSnapshot
      }
      onClose={onClose}
      onRestored={(restored) => onRestore(restored as KnowledgeArticleSnapshot)}
    />
  );
}
