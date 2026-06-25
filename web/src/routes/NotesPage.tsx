import { useState, useEffect } from "react";
import { Search, Plus, Trash2, FileText, History as HistoryIcon } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { VersionHistoryPanel } from "@/components/VersionHistoryPanel";
import { useCreateAction } from "@/hooks/useGlobalShortcuts";
import { useProjectContext } from "@/store/projectContext";
import { useNotes, useSearchNotes, useCreateNote, useUpdateNote, useDeleteNote } from "@/features/notes/api";
import type { NoteSnapshot } from "@/types/versions";
import { useTranslation } from "react-i18next";

/**
 * Notes page — left: searchable note list, right: markdown editor.
 *
 * Filters by the TopBar project context. Full-text search hits the
 * backend FTS index; embedding/semantic search is deferred to the
 * future LLM-settings integration.
 */
export default function NotesPage() {
  const { t } = useTranslation();
  const { selectedProjectId } = useProjectContext();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showHistory, setShowHistory] = useState(false);

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const isSearching = debouncedSearch.length > 0;
  const { data: searchData } = useSearchNotes(debouncedSearch);
  const { data: listData } = useNotes(selectedProjectId ?? undefined);
  const notes = isSearching
    ? (searchData?.notes ?? [])
    : (listData?.notes ?? []);

  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  // Debounced autosave — fires 800ms after the last keystroke.
  useEffect(() => {
    if (!selectedId || !dirty) return;

    const id = setTimeout(() => {
      setSaveStatus("saving");
      updateNote.mutate(
        { id: selectedId, body: { title: draftTitle, content: draftContent } },
        {
          onSuccess: () => {
            setDirty(false);
            setSaveStatus("saved");
          },
          onError: () => setSaveStatus("error"),
        },
      );
    }, 800);

    return () => clearTimeout(id);
  }, [dirty, draftTitle, draftContent, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNewNote() {
    setCreateError(false);
    // Flush pending changes before creating a new note.
    if (dirty && selectedId) {
      updateNote.mutate({
        id: selectedId,
        body: { title: draftTitle, content: draftContent },
      });
    }
    createNote.mutate(
      {
        title: t("notes.untitled"),
        projectId: selectedProjectId ?? undefined,
      },
      {
        onSuccess: (res) => {
          setSelectedId(res.note.id);
          setDraftTitle(res.note.title);
          setDraftContent("");
          setDirty(false);
          setSaveStatus("idle");
        },
        onError: () => setCreateError(true),
      },
    );
  }

  function handleSelectNote(id: string) {
    if (id === selectedId) return;
    // Flush pending changes before switching.
    if (dirty && selectedId) {
      updateNote.mutate({
        id: selectedId,
        body: { title: draftTitle, content: draftContent },
      });
    }
    // Sync editor to the newly selected note.
    const note = notes.find((n) => n.id === id);
    if (note) {
      setDraftTitle(note.title);
      setDraftContent(note.content ?? "");
      setDirty(false);
      setSaveStatus("idle");
    }
    setSelectedId(id);
  }

  function handleDelete(id: string) {
    deleteNote.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null);
      },
    });
  }

  function onTitleChange(v: string) {
    setDraftTitle(v);
    setDirty(true);
  }
  function onContentChange(v: string) {
    setDraftContent(v);
    setDirty(true);
  }

  // Keyboard shortcut: press N on the notes page to create a new note.
  const createNonce = useCreateAction("create.note");
  useEffect(() => {
    if (createNonce > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleNewNote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createNonce]);

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        {/* Left: note list + search */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border)]">
          <div className="flex items-center gap-2 px-4 pb-3 pt-4">
            <h2 className="text-sm font-semibold text-[var(--text)]">
              {t("notes.notes")}
            </h2>
            <button
              onClick={handleNewNote}
              disabled={createNote.isPending}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-50"
              title={t("notes.newNote")}
            >
              <Plus size={16} />
            </button>
          </div>
          {createError && (
            <div className="px-4 pb-2 text-xs text-[var(--status-error)]">
              {t("notes.createError")}
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("notes.searchPlaceholder")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {notes.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--text-dim)]">
                {isSearching ? t("notes.noResults") : t("notes.empty")}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleSelectNote(n.id)}
                      className={`group flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors ${
                        selectedId === n.id
                          ? "bg-[var(--surface-hover)]"
                          : "hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      <FileText
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--text-dim)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text)]">
                          {n.title || t("notes.untitled")}
                        </div>
                        <div className="truncate text-xs text-[var(--text-dim)]">
                          {n.content
                            ? n.content.slice(0, 60)
                            : t("notes.noContent")}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-6 py-3">
                <input
                  value={draftTitle}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder={t("notes.titlePlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none"
                />
                {/* Autosave status indicator */}
                <div className="min-w-[80px] text-right">
                  {saveStatus === "saving" && (
                    <span className="text-xs text-[var(--text-muted)]">
                      {t("common.saving")}
                    </span>
                  )}
                  {saveStatus === "saved" && !dirty && (
                    <span className="text-xs text-[var(--status-active)]">
                      {t("notes.saved")}
                    </span>
                  )}
                  {saveStatus === "error" && (
                    <span className="text-xs text-[var(--status-error)]">
                      {t("notes.saveError")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowHistory(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  title={t("notes.versionHistory")}
                >
                  <HistoryIcon size={15} />
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  disabled={deleteNote.isPending}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:opacity-50"
                  title={t("notes.delete")}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
                <textarea
                  value={draftContent}
                  onChange={(e) => onContentChange(e.target.value)}
                  placeholder={t("notes.contentPlaceholder")}
                  className="h-full w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none"
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
              {t("notes.selectPrompt")}
            </div>
          )}
        </div>
      </div>

      {/* Version history panel (slide-over) */}
      {showHistory && selectedId && selected && (
        <VersionHistoryPanel
          entityType="note"
          entityId={selectedId}
          current={{
            title: draftTitle,
            content: draftContent,
            tags: selected.tags,
            pinned: selected.pinned,
            projectId: selected.projectId,
          }}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => {
            const n = restored as NoteSnapshot;
            setDraftTitle(n.title);
            setDraftContent(n.content);
            setDirty(false);
            setSaveStatus("idle");
          }}
        />
      )}
    </AppLayout>
  );
}
