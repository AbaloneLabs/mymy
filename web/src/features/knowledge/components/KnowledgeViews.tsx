import { useMemo, useState, type ReactNode } from "react";
import {
  Trash2,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Pencil,
  Eye,
  Check,
  Hash,
  Home,
  History as HistoryIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useKnowledgeBreadcrumb } from "@/features/knowledge/api";
import { cn } from "@/lib/utils";
import { extractHeadings, scrollToHeading, type FlatNode } from "@/features/knowledge/utils";
import type {
  KnowledgeArticle,
  KnowledgeNodeType,
  KnowledgeTreeNode,
} from "@/types/knowledge";

// ============================================================
// Tree sidebar
// ============================================================

interface TreeViewProps {
  nodes: KnowledgeTreeNode[];
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
  onToggle: (id: string) => void;
  onMove: (id: string, parentId: string | null) => void;
  emptyText: string;
}

export function TreeView({
  nodes,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  onMove,
  emptyText,
}: TreeViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const draggedId = String(active.id);
    const targetId = String(over.id);
    // "root" is a special droppable id for moving to the top level.
    const parentId = targetId === "root" ? null : targetId;
    // Dropping onto itself is a no-op.
    if (draggedId === targetId) return;
    onMove(draggedId, parentId);
  }

  if (nodes.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-sm text-[var(--text-dim)]">
        {emptyText}
      </div>
    );
  }
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {/* Root-level drop target so nodes can be dragged out to the top. */}
      <RootDropZone id="root">
        <ul className="space-y-0.5">
          {nodes.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </RootDropZone>
    </DndContext>
  );
}

/** A droppable wrapper that highlights when a dragged node hovers over it.
 * Stretches to fill the available height so the empty area below the last
 * tree row also acts as a "move to root" drop target. */
function RootDropZone({ id, children }: { id: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-full",
        isOver && "rounded-md ring-1 ring-[var(--accent)]/40",
      )}
    >
      {children}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: {
  node: KnowledgeTreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
  onToggle: (id: string) => void;
}) {
  const isCategory = node.nodeType === "category";
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = selectedId === node.id;
  const isDraft = node.status === "draft";
  const { t } = useTranslation();

  // Make every row draggable, and categories droppable (drop targets).
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: node.id });

  return (
    <li>
      <div
        ref={(el) => {
          setDragRef(el);
          if (isCategory) setDropRef(el);
        }}
        {...attributes}
        {...listeners}
        className={cn(
          "group flex items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors",
          isActive
            ? "bg-[var(--surface-hover)] text-[var(--text)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          isDragging && "opacity-40",
          isCategory && isOver && "ring-1 ring-[var(--accent)]/60",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isCategory ? (
          <button
            onClick={() => onToggle(node.id)}
            className="flex shrink-0 items-center"
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown size={14} className="text-[var(--text-dim)]" />
              ) : (
                <ChevronRight size={14} className="text-[var(--text-dim)]" />
              )
            ) : (
              <span className="w-[14px]" />
            )}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id, node.nodeType)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {isCategory ? (
            isOpen ? (
              <FolderOpen size={14} className="shrink-0 text-[var(--text-dim)]" />
            ) : (
              <Folder size={14} className="shrink-0 text-[var(--text-dim)]" />
            )
          ) : (
            <FileText size={14} className="shrink-0 text-[var(--text-dim)]" />
          )}
          <span className="truncate">{node.title || t("knowledge.untitled")}</span>
          {isDraft && (
            <span className="ml-1 shrink-0 rounded bg-[var(--surface)] px-1 py-0.5 text-[10px] text-[var(--text-faint)]">
              {t("knowledge.status.draft")}
            </span>
          )}
        </button>
      </div>
      {isCategory && isOpen && hasChildren && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ============================================================
// Search result list (flat)
// ============================================================

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

// ============================================================
// Markdown viewer (read mode)
// ============================================================

// ============================================================
// Breadcrumb (location path)
// ============================================================

interface BreadcrumbProps {
  articleId: string;
  onSelect: (id: string, nodeType?: KnowledgeNodeType) => void;
}

/** Renders the root → current path and lets each segment be clicked. */
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

// ============================================================
// Markdown viewer (read mode)
// ============================================================

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
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-[var(--text-dim)]">
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
      </div>
    </>
  );
}

// ============================================================
// Editor (write mode)
// ============================================================

interface EditorProps {
  draftTitle: string;
  draftContent: string;
  draftSlug: string;
  draftExcerpt: string;
  draftTags: string;
  draftNodeType: KnowledgeNodeType;
  draftParentId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  parentOptions: FlatNode[];
  currentId: string | null;
  onTitle: (v: string) => void;
  onContent: (v: string) => void;
  onSlug: (v: string) => void;
  onExcerpt: (v: string) => void;
  onTags: (v: string) => void;
  onParentId: (v: string | null) => void;
  onDone: () => void;
}

export function Editor(props: EditorProps) {
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-6 py-3">
        <div className="min-w-[80px] text-right">
          {props.saveStatus === "saving" && (
            <span className="text-xs text-[var(--text-muted)]">{t("knowledge.saving")}</span>
          )}
          {props.saveStatus === "saved" && (
            <span className="text-xs text-[var(--status-active)]">{t("knowledge.saved")}</span>
          )}
          {props.saveStatus === "error" && (
            <span className="text-xs text-[var(--status-error)]">{t("knowledge.saveError")}</span>
          )}
        </div>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={showPreview ? t("knowledge.write") : t("knowledge.preview")}
        >
          {showPreview ? <Pencil size={13} /> : <Eye size={13} />}
          {showPreview ? t("knowledge.write") : t("knowledge.preview")}
        </button>
        <button
          onClick={props.onDone}
          className="flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white transition-colors hover:opacity-90"
        >
          <Check size={13} />
          {t("common.save")}
        </button>
      </div>

      {/* Metadata fields */}
      <div className="grid grid-cols-2 gap-3 border-b border-[var(--border)] px-6 py-3">
        <Field label={t("knowledge.titlePlaceholder")}>
          <input
            value={props.draftTitle}
            onChange={(e) => props.onTitle(e.target.value)}
            placeholder={t("knowledge.titlePlaceholder")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </Field>
        <Field label={t("knowledge.parent")}>
          <select
            value={props.draftParentId ?? ""}
            onChange={(e) => props.onParentId(e.target.value || null)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">{t("knowledge.none")}</option>
            {props.parentOptions
              .filter((o) => o.id !== props.currentId && o.nodeType === "category")
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {"  ".repeat(o.depth)}
                  {o.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("knowledge.tags")}>
          <input
            value={props.draftTags}
            onChange={(e) => props.onTags(e.target.value)}
            placeholder={t("knowledge.tagsPlaceholder")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </Field>
        <div className="col-span-2">
          <Field label={t("knowledge.excerpt")}>
            <input
              value={props.draftExcerpt}
              onChange={(e) => props.onExcerpt(e.target.value)}
              placeholder={t("knowledge.excerpt")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
            />
          </Field>
        </div>
      </div>

      {/* Content editor / preview */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {props.draftNodeType === "category" ? (
          <div />
        ) : showPreview ? (
          <div className="h-full overflow-y-auto px-8 py-6">
            <div className="knowledge-prose mx-auto max-w-3xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {props.draftContent || ""}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <textarea
            value={props.draftContent}
            onChange={(e) => props.onContent(e.target.value)}
            placeholder=""
            className="m-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-4 font-mono text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--text-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}

// ============================================================
// Table of contents (right panel)
// ============================================================

export function TableOfContents({ content }: { content: string }) {
  const { t } = useTranslation();
  const items = useMemo(() => extractHeadings(content), [content]);

  if (items.length === 0) return null;

  return (
    <div className="hidden w-[220px] shrink-0 flex-col border-l border-[var(--border)] xl:flex">
      <div className="flex items-center gap-1.5 px-4 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        <Hash size={12} />
        {t("knowledge.toc")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i}>
              <button
                onClick={() => scrollToHeading(item.id)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
