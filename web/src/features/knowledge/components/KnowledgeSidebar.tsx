import { BookOpen, Folder, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  KnowledgeArticle,
  KnowledgeNodeType,
  KnowledgeTreeNode,
} from "@/types/knowledge";
import { SearchResultList, TreeView } from "./KnowledgeViews";

export function KnowledgeSidebar({
  search,
  isSearching,
  treeNodes,
  searchResults,
  selected,
  selectedId,
  expanded,
  createPending,
  createError,
  moveError,
  onSearch,
  onCreate,
  onSelect,
  onToggleExpand,
  onMove,
  onDismissMoveError,
}: {
  search: string;
  isSearching: boolean;
  treeNodes: KnowledgeTreeNode[];
  searchResults: KnowledgeArticle[];
  selected: KnowledgeArticle | null;
  selectedId: string | null;
  expanded: Set<string>;
  createPending: boolean;
  createError: boolean;
  moveError: boolean;
  onSearch: (value: string) => void;
  onCreate: (nodeType: KnowledgeNodeType, parentId?: string | null) => void;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
  onToggleExpand: (id: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  onDismissMoveError: () => void;
}) {
  const { t } = useTranslation();
  const parentId = selected?.parentId ?? selected?.id;

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <BookOpen size={16} className="text-[var(--text-dim)]" />
        <h2 className="text-sm font-semibold text-[var(--text)]">
          {t("knowledge.title")}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onCreate("category", parentId)}
            disabled={createPending}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
            title={t("knowledge.newCategory")}
          >
            <Folder size={15} />
          </button>
          <button
            onClick={() => onCreate("article", parentId)}
            disabled={createPending}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
            title={t("knowledge.newArticle")}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {createError && (
        <div className="px-4 pb-2 text-xs text-[var(--status-error)]">
          {t("knowledge.createError")}
        </div>
      )}
      {moveError && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 px-3 py-1.5 text-xs text-[var(--status-error)]">
          <span>{t("knowledge.moveError")}</span>
          <button
            onClick={onDismissMoveError}
            className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
      )}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]"
          />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("knowledge.searchPlaceholder")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4">
        {isSearching ? (
          <SearchResultList
            results={searchResults}
            selectedId={selectedId}
            onSelect={onSelect}
            emptyText={t("knowledge.noResults")}
          />
        ) : (
          <TreeView
            nodes={treeNodes}
            selectedId={selectedId}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggleExpand}
            onMove={onMove}
            emptyText={t("knowledge.empty")}
          />
        )}
      </div>
    </div>
  );
}
