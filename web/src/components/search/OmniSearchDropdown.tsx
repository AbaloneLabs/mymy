import type { ReactNode } from "react";
import {
  BookOpen,
  Calendar,
  CheckSquare,
  FolderGit2,
  MessageSquare,
  StickyNote,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SearchResults } from "@/types/search";
import {
  type FlatSearchResult,
  findFlatSearchResultIndex,
} from "./omniSearchResults";

export function OmniSearchDropdown({
  query,
  results,
  flatResults,
  activeIndex,
  total,
  isFetching,
  hasResults,
  onNavigate,
}: {
  query: string;
  results?: SearchResults;
  flatResults: FlatSearchResult[];
  activeIndex: number;
  total: number;
  isFetching: boolean;
  hasResults: boolean;
  onNavigate: (result: FlatSearchResult) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute left-0 top-full mt-1 max-h-[70vh] w-full min-w-[22rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
      {!hasResults && !isFetching && (
        <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t("search.noResults", { query })}
        </div>
      )}

      {results && hasResults && (
        <div className="py-1">
          {results.notes.length > 0 && (
            <SearchGroup
              label={t("search.groupNotes")}
              icon={<StickyNote className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.notes.map((note) => {
                const result = { type: "note", item: note } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`note-${note.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
                    title={note.title}
                    subtitle={note.preview}
                  />
                );
              })}
            </SearchGroup>
          )}

          {results.tasks.length > 0 && (
            <SearchGroup
              label={t("search.groupTasks")}
              icon={<CheckSquare className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.tasks.map((task) => {
                const result = { type: "task", item: task } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`task-${task.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
                    title={task.title}
                    subtitle={task.priority}
                  />
                );
              })}
            </SearchGroup>
          )}

          {results.projects.length > 0 && (
            <SearchGroup
              label={t("search.groupProjects")}
              icon={<FolderGit2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.projects.map((project) => {
                const result = { type: "project", item: project } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`project-${project.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
                    title={project.name}
                    subtitle={project.description}
                  />
                );
              })}
            </SearchGroup>
          )}

          {results.events.length > 0 && (
            <SearchGroup
              label={t("search.groupEvents")}
              icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.events.map((event) => {
                const result = { type: "event", item: event } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`event-${event.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
                    title={event.title}
                    subtitle={event.startDate}
                  />
                );
              })}
            </SearchGroup>
          )}

          {results.messages.length > 0 && (
            <SearchGroup
              label={t("search.groupMessages")}
              icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.messages.map((message) => {
                const result = { type: "message", item: message } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`message-${message.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
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

          {results.knowledge.length > 0 && (
            <SearchGroup
              label={t("search.groupKnowledge")}
              icon={<BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />}
            >
              {results.knowledge.map((article) => {
                const result = { type: "knowledge", item: article } as const;
                const idx = findFlatSearchResultIndex(flatResults, result);
                return (
                  <ResultRow
                    key={`knowledge-${article.id}`}
                    active={activeIndex === idx}
                    onClick={() => onNavigate(result)}
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
  );
}

function SearchGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
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
        <span className="truncate text-[11px] text-[var(--text-muted)]">
          {subtitle}
        </span>
      )}
    </button>
  );
}
