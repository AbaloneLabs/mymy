import type { ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  KnowledgeNodeType,
  KnowledgeTreeNode,
} from "@/types/knowledge";

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
    const parentId = targetId === "root" ? null : targetId;
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
