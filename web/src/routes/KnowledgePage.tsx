import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useTranslation } from "react-i18next";
import {
  useKnowledgeTree,
  useKnowledgeArticle,
  useSearchKnowledge,
  useCreateKnowledgeArticle,
  useUpdateKnowledgeArticle,
  useDeleteKnowledgeArticle,
  useMoveKnowledgeArticle,
} from "@/features/knowledge/api";
import { TableOfContents } from "@/features/knowledge/components/KnowledgeTableOfContents";
import { KnowledgeHistoryPanel } from "@/features/knowledge/components/KnowledgeHistoryPanel";
import { KnowledgeSidebar } from "@/features/knowledge/components/KnowledgeSidebar";
import {
  flattenTree,
  parseTags,
} from "@/features/knowledge/utils";
import { useProjectContext } from "@/store/projectContext";
import type {
  KnowledgeArticle,
  KnowledgeNodeType,
  KnowledgeStatus,
} from "@/types/knowledge";

const Viewer = lazy(() =>
  import("@/features/knowledge/components/KnowledgeViewer").then((module) => ({
    default: module.Viewer,
  })),
);
const Editor = lazy(() =>
  import("@/features/knowledge/components/KnowledgeEditor").then((module) => ({
    default: module.Editor,
  })),
);

/**
 * Knowledge Base page — a 3-panel workspace:
 *   left:   document tree (categories + articles, expand/collapse)
 *   center: markdown viewer (read mode) or editor (write mode)
 *   right:  table of contents (auto-generated from headings)
 *
 * Articles are stored as markdown and rendered with react-markdown + GFM.
 * Categories are folder-like nodes that group articles.
 */
export default function KnowledgePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("id"));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [createError, setCreateError] = useState(false);

  // Editor draft state (populated when entering edit mode).
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [draftExcerpt, setDraftExcerpt] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftStatus, setDraftStatus] = useState<KnowledgeStatus>("draft");
  const [draftNodeType, setDraftNodeType] = useState<KnowledgeNodeType>("article");
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [moveError, setMoveError] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const draftRevisionRef = useRef(0);

  // Global project filter from the TopBar dropdown. null = "All Projects".
  // Documents created under "All Projects" get no project and are hidden
  // when a specific project filter is active.
  const selectedProjectId = useProjectContext((s) => s.selectedProjectId);

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const isSearching = debouncedSearch.length > 0;
  const { data: treeData } = useKnowledgeTree(selectedProjectId ?? undefined);
  const { data: searchData } = useSearchKnowledge(debouncedSearch);
  const { data: articleData } = useKnowledgeArticle(selectedId);

  const createArticle = useCreateKnowledgeArticle();
  const updateArticle = useUpdateKnowledgeArticle();
  const deleteArticle = useDeleteKnowledgeArticle();
  const moveArticle = useMoveKnowledgeArticle();

  const selected: KnowledgeArticle | null = articleData?.article ?? null;

  // Flat list of all nodes for the parent-category dropdown in the editor.
  const allNodes = useMemo(() => flattenTree(treeData?.tree ?? []), [treeData]);

  const searchResults = searchData?.articles ?? [];

  /** Populate the editor draft from an article (used on create + edit start). */
  const populateDraft = useCallback((article: KnowledgeArticle) => {
    draftRevisionRef.current += 1;
    setDraftTitle(article.title);
    setDraftContent(article.content);
    setDraftSlug(article.slug);
    setDraftExcerpt(article.excerpt);
    setDraftTags(article.tags.join(", "));
    setDraftStatus(article.status);
    setDraftNodeType(article.nodeType);
    setDraftParentId(article.parentId ?? null);
    setDirty(false);
    setSaveStatus("idle");
  }, []);

  /** Enter edit mode for the currently selected article. */
  const handleStartEdit = useCallback(() => {
    if (selected) populateDraft(selected);
    setMode("edit");
  }, [selected, populateDraft]);

  // Build the update body from current draft state. parentId is sent as null
  // (not omitted) so the backend can move a node to the root level.
  const buildUpdateBody = useCallback(
    () => ({
      title: draftTitle,
      content: draftContent,
      slug: draftSlug,
      excerpt: draftExcerpt,
      tags: parseTags(draftTags),
      status: draftStatus,
      nodeType: draftNodeType,
      parentId: draftParentId,
    }),
    [draftTitle, draftContent, draftSlug, draftExcerpt, draftTags, draftStatus, draftNodeType, draftParentId],
  );

  // Debounced autosave in edit mode — fires 1s after the last change. We
  // capture the draft snapshot at fire time so that a later edit (which
  // re-enables dirty) is not lost when this save resolves.
  useEffect(() => {
    if (mode !== "edit" || !selectedId || !dirty || updateArticle.isPending) return;
    const id = setTimeout(() => {
      const savingRevision = draftRevisionRef.current;
      setSaveStatus("saving");
      updateArticle.mutate(
        { id: selectedId, body: buildUpdateBody() },
        {
          onSuccess: () => {
            if (draftRevisionRef.current === savingRevision) {
              setDirty(false);
              setSaveStatus("saved");
            } else {
              // The acknowledged request covered an older draft. Keeping the
              // editor dirty causes one coalesced follow-up save after the
              // mutation leaves its pending state.
              setSaveStatus("idle");
            }
          },
          onError: () => {
            if (draftRevisionRef.current === savingRevision) {
              setSaveStatus("error");
            }
          },
        },
      );
    }, 1000);
    return () => clearTimeout(id);
  }, [dirty, selectedId, mode, buildUpdateBody, updateArticle.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Flush pending edits immediately (used on select-switch + Save). */
  const flushPending = useCallback(() => {
    if (mode === "edit" && dirty && selectedId) {
      updateArticle.mutate({ id: selectedId, body: buildUpdateBody() });
      setDirty(false);
    }
  }, [mode, dirty, selectedId, buildUpdateBody, updateArticle]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Selecting a document loads it in the right panel. Selecting a folder
  // only toggles expand/collapse and highlights it without replacing the
  // panel content, so the user can keep reading the current document while
  // browsing the tree. An empty id (from the breadcrumb Home icon) clears
  // the selection.
  const handleSelect = useCallback(
    (id: string, nodeType?: KnowledgeNodeType) => {
      if (id === "") {
        flushPending();
        setSelectedId(null);
        setMode("read");
        return;
      }
      // Flush pending edits before switching documents.
      flushPending();
      if (nodeType === "category") {
        // Folder click: toggle + highlight, keep the current panel content.
        setSelectedId(id);
        setMode("read");
        handleToggleExpand(id);
      } else {
        setSelectedId(id);
        setMode("read");
      }
    },
    [flushPending, handleToggleExpand],
  );

  function handleCreate(nodeType: KnowledgeNodeType, parentId?: string | null) {
    setCreateError(false);
    createArticle.mutate(
      {
        title: t("knowledge.untitled"),
        nodeType,
        parentId: parentId ?? undefined,
        // Root nodes carry the project; children inherit from their root.
        // "All Projects" (null) → no project.
        projectId: selectedProjectId ?? undefined,
        status: "draft",
      },
      {
        onSuccess: (res) => {
          const id = res.article.id;
          // Expand the parent so the new node is visible.
          if (parentId) {
            setExpanded((prev) => new Set(prev).add(parentId));
          }
          setSelectedId(id);
          populateDraft(res.article);
          setMode("edit");
        },
        onError: () => setCreateError(true),
      },
    );
  }

  function handleDelete(id: string) {
    deleteArticle.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) {
          setSelectedId(null);
          setMode("read");
        }
      },
    });
  }

  function handleEditField() {
    draftRevisionRef.current += 1;
    setDirty(true);
  }

  /** Save button handler: flush pending edits immediately, then exit edit. */
  const handleDoneEdit = useCallback(() => {
    flushPending();
    setSaveStatus("idle");
    setMode("read");
  }, [flushPending]);

  /** Move a node to a new parent (drag-and-drop). null parentId = root.
   *  When moving to root, assign the current project filter so the node
   *  stays visible under the active filter. */
  const handleMove = useCallback(
    (id: string, parentId: string | null) => {
      const body: { parentId: string | null; projectId?: string | null } = { parentId };
      if (parentId === null) {
        body.projectId = selectedProjectId ?? null;
      }
      moveArticle.mutate(
        { id, body },
        {
          onError: () => {
            // Backend rejects cycles / self-parent with HTTP 400.
            setMoveError(true);
          },
        },
      );
    },
    [moveArticle, selectedProjectId],
  );

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        <KnowledgeSidebar
          search={search}
          isSearching={isSearching}
          treeNodes={treeData?.tree ?? []}
          searchResults={searchResults}
          selected={selected}
          selectedId={selectedId}
          expanded={expanded}
          createPending={createArticle.isPending}
          createError={createError}
          moveError={moveError}
          onSearch={setSearch}
          onCreate={handleCreate}
          onSelect={handleSelect}
          onToggleExpand={handleToggleExpand}
          onMove={handleMove}
          onDismissMoveError={() => setMoveError(false)}
        />

        {/* Center: viewer / editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]" aria-busy="true">
                …
              </div>
            }
          >
            {selected ? (
              mode === "read" ? (
                <Viewer
                  article={selected}
                  onEdit={handleStartEdit}
                  onDelete={() => handleDelete(selected.id)}
                  deleting={deleteArticle.isPending}
                  onSelect={handleSelect}
                  onShowHistory={() => setShowHistory(true)}
                />
              ) : (
                <Editor
                  draftTitle={draftTitle}
                  draftContent={draftContent}
                  draftSlug={draftSlug}
                  draftExcerpt={draftExcerpt}
                  draftTags={draftTags}
                  draftNodeType={draftNodeType}
                  draftParentId={draftParentId}
                  saveStatus={saveStatus}
                  parentOptions={allNodes}
                  currentId={selectedId}
                  onTitle={(v) => {
                    setDraftTitle(v);
                    handleEditField();
                  }}
                  onContent={(v) => {
                    setDraftContent(v);
                    handleEditField();
                  }}
                  onSlug={(v) => {
                    setDraftSlug(v);
                    handleEditField();
                  }}
                  onExcerpt={(v) => {
                    setDraftExcerpt(v);
                    handleEditField();
                  }}
                  onTags={(v) => {
                    setDraftTags(v);
                    handleEditField();
                  }}
                  onParentId={(v) => {
                    setDraftParentId(v);
                    handleEditField();
                  }}
                  onDone={handleDoneEdit}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
                {t("knowledge.selectPrompt")}
              </div>
            )}
          </Suspense>
        </div>

        {/* Right: table of contents (only in read mode with content) */}
        {selected && mode === "read" && selected.nodeType === "article" && (
          <TableOfContents content={selected.content} />
        )}
      </div>

      <KnowledgeHistoryPanel
        open={showHistory}
        selectedId={selectedId}
        selected={selected}
        onClose={() => setShowHistory(false)}
        onRestore={(snapshot) => {
          if (!selectedId) return;
          updateArticle.mutate(
            {
              id: selectedId,
              body: {
                title: snapshot.title,
                content: snapshot.content,
                slug: snapshot.slug,
                excerpt: snapshot.excerpt,
                tags: snapshot.tags,
                status: snapshot.status as KnowledgeStatus,
                nodeType: snapshot.nodeType as KnowledgeNodeType,
                parentId: snapshot.parentId ?? null,
              },
            },
            { onSuccess: () => setShowHistory(false) },
          );
        }}
      />
    </AppLayout>
  );
}
