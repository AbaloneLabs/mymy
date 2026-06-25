import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  X,
  StickyNote,
  CheckSquare,
  FolderGit2,
  Calendar,
  MessageSquare,
  BookOpen,
  Loader2,
} from "lucide-react";
import { useOmniSearch } from "@/features/search/api";
import { useProjectContext } from "@/store/projectContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";

/**
 * OmniSearch — global unified search box shown in the TopBar.
 *
 * Fires a debounced (300ms) query to GET /api/search and renders grouped
 * results (notes, tasks, projects, events, messages) in a dropdown.
 * Clicking a result navigates to the entity's page. The query is scoped
 * to the currently selected project context when one is active.
 */
export function OmniSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedProjectId } = useProjectContext();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query, 300);
  const trimmed = debouncedQuery.trim();
  const { data, isFetching } = useOmniSearch(trimmed, selectedProjectId);

  // Flatten results into a single navigable list for keyboard navigation.
  const flatResults = useMemo(() => {
    if (!data) return [];
    const r = data.results;
    const items: { type: string; item: Record<string, unknown> }[] = [];
    r.notes.forEach((item) => items.push({ type: "note", item: item as unknown as Record<string, unknown> }));
    r.tasks.forEach((item) => items.push({ type: "task", item: item as unknown as Record<string, unknown> }));
    r.projects.forEach((item) => items.push({ type: "project", item: item as unknown as Record<string, unknown> }));
    r.events.forEach((item) => items.push({ type: "event", item: item as unknown as Record<string, unknown> }));
    r.messages.forEach((item) => items.push({ type: "message", item: item as unknown as Record<string, unknown> }));
    r.knowledge.forEach((item) => items.push({ type: "knowledge", item: item as unknown as Record<string, unknown> }));
    return items;
  }, [data]);

  const total = data?.total ?? 0;

  // Clamp activeIndex so it never exceeds the result set length.
  const safeActiveIndex = flatResults.length > 0
    ? Math.min(activeIndex, flatResults.length - 1)
    : 0;

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard shortcut: "/" focuses the search input.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function navigateTo(type: string, item: Record<string, unknown>) {
    switch (type) {
      case "note":
        navigate("/notes");
        break;
      case "task":
        navigate("/tasks");
        break;
      case "project":
        navigate(`/projects/${item.id}`);
        break;
      case "event":
        navigate("/calendar");
        break;
      case "message":
        navigate("/chat");
        break;
      case "knowledge":
        navigate("/knowledge");
        break;
    }
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || flatResults.length === 0) {
      if (e.key === "ArrowDown" && trimmed) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = flatResults[safeActiveIndex];
      if (sel) navigateTo(sel.type, sel.item);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && trimmed.length > 0;
  const hasResults = flatResults.length > 0;

  return (
    <div className="relative flex-1 max-w-md" ref={containerRef}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]"
          strokeWidth={1.5}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t("search.placeholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-8 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        {isFetching && (
          <Loader2
            className="absolute right-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
        )}
        {query && !isFetching && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label={t("search.clear")}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full mt-1 max-h-[70vh] w-full min-w-[22rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
          {!hasResults && !isFetching && (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
              {t("search.noResults", { query: trimmed })}
            </div>
          )}

          {hasResults && (
            <div className="py-1">
              {data!.results.notes.length > 0 && (
                <SearchGroup
                  label={t("search.groupNotes")}
                  icon={<StickyNote className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.notes.map((note) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "note" && r.item.id === note.id,
                    );
                    return (
                      <ResultRow
                        key={`note-${note.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() => navigateTo("note", note as unknown as Record<string, unknown>)}
                        title={note.title}
                        subtitle={note.preview}
                      />
                    );
                  })}
                </SearchGroup>
              )}

              {data!.results.tasks.length > 0 && (
                <SearchGroup
                  label={t("search.groupTasks")}
                  icon={<CheckSquare className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.tasks.map((task) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "task" && r.item.id === task.id,
                    );
                    return (
                      <ResultRow
                        key={`task-${task.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() => navigateTo("task", task as unknown as Record<string, unknown>)}
                        title={task.title}
                        subtitle={task.priority}
                      />
                    );
                  })}
                </SearchGroup>
              )}

              {data!.results.projects.length > 0 && (
                <SearchGroup
                  label={t("search.groupProjects")}
                  icon={<FolderGit2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.projects.map((project) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "project" && r.item.id === project.id,
                    );
                    return (
                      <ResultRow
                        key={`project-${project.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() =>
                          navigateTo("project", project as unknown as Record<string, unknown>)
                        }
                        title={project.name}
                        subtitle={project.description}
                      />
                    );
                  })}
                </SearchGroup>
              )}

              {data!.results.events.length > 0 && (
                <SearchGroup
                  label={t("search.groupEvents")}
                  icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.events.map((event) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "event" && r.item.id === event.id,
                    );
                    return (
                      <ResultRow
                        key={`event-${event.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() => navigateTo("event", event as unknown as Record<string, unknown>)}
                        title={event.title}
                        subtitle={event.startDate}
                      />
                    );
                  })}
                </SearchGroup>
              )}

              {data!.results.messages.length > 0 && (
                <SearchGroup
                  label={t("search.groupMessages")}
                  icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.messages.map((message) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "message" && r.item.id === message.id,
                    );
                    return (
                      <ResultRow
                        key={`message-${message.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() =>
                          navigateTo("message", message as unknown as Record<string, unknown>)
                        }
                        title={message.title}
                        subtitle={
                          message.entityType === "chatMessage"
                            ? t("search.messageInSession")
                            : undefined
                        }
                      />
                    );
                  })}
                </SearchGroup>
              )}

              {data!.results.knowledge.length > 0 && (
                <SearchGroup
                  label={t("search.groupKnowledge")}
                  icon={<BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />}
                >
                  {data!.results.knowledge.map((article) => {
                    const idx = flatResults.findIndex(
                      (r) => r.type === "knowledge" && r.item.id === article.id,
                    );
                    return (
                      <ResultRow
                        key={`knowledge-${article.id}`}
                        active={safeActiveIndex === idx}
                        onClick={() =>
                          navigateTo("knowledge", article as unknown as Record<string, unknown>)
                        }
                        title={article.title}
                        subtitle={article.preview}
                      />
                    );
                  })}
                </SearchGroup>
              )}

              <div className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
                {t("search.totalResults", { count: total })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A labeled group of search results within the dropdown. */
function SearchGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

/** A single selectable search result row. */
function ResultRow({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors duration-100",
        active ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]",
      )}
    >
      <span className="truncate text-[13px] text-[var(--text)]">{title}</span>
      {subtitle && (
        <span className="truncate text-[11px] text-[var(--text-muted)]">{subtitle}</span>
      )}
    </button>
  );
}
