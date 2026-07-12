import {
  type KeyboardEvent as ReactKeyboardEvent,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  X,
  Loader2,
} from "lucide-react";
import { OmniSearchDropdown } from "@/components/search/OmniSearchDropdown";
import { workspaceSearchHitRoute } from "@/components/search/omniSearchResults";
import { useOmniSearch } from "@/features/search/api";
import { useProjectContext } from "@/store/projectContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { WorkspaceSearchHit } from "@/types/search";

/**
 * OmniSearch — global unified search box shown in the TopBar.
 *
 * Fires one debounced atomic request through the shared federated adapters.
 * Results retain typed domain/lifecycle metadata and navigate through a
 * registered internal route. The query is scoped to the selected project plus
 * global resources when a project context is active.
 */
export function OmniSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    selectedProjectId,
    setSelectedProjectId,
    setSelectedAgentProfile,
  } = useProjectContext();

  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(committedQuery, 300);
  const trimmed = debouncedQuery.trim();
  const { data, isFetching } = useOmniSearch(trimmed, selectedProjectId, open);
  const hits = useMemo(() => data?.hits ?? [], [data?.hits]);

  // Clamp activeIndex so it never exceeds the result set length.
  const safeActiveIndex = hits.length > 0
    ? Math.min(activeIndex, hits.length - 1)
    : 0;

  const closeSearch = useCallback(() => {
    setOpen(false);
    void queryClient.cancelQueries({ queryKey: ["workspace-search"] });
  }, [queryClient]);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSearch();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeSearch]);

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

  function navigateTo(hit: WorkspaceSearchHit) {
    if (["notes", "tasks", "calendar", "sessions"].includes(hit.domain)) {
      setSelectedProjectId(hit.projectId ?? null);
    }
    if (hit.domain === "sessions") {
      setSelectedAgentProfile(null);
    }
    navigate(workspaceSearchHitRoute(hit));
    closeSearch();
    setQuery("");
    setCommittedQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (!open || hits.length === 0) {
      if (e.key === "ArrowDown" && trimmed) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = hits[safeActiveIndex];
      if (sel) navigateTo(sel);
    } else if (e.key === "Escape") {
      closeSearch();
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && trimmed.length > 0;

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
            if (!(e.nativeEvent as InputEvent).isComposing) {
              setCommittedQuery(e.target.value);
            }
            setActiveIndex(0);
            setOpen(true);
          }}
          onCompositionEnd={(event) => {
            setCommittedQuery(event.currentTarget.value);
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
              setCommittedQuery("");
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
        <OmniSearchDropdown
          query={trimmed}
          hits={hits}
          partialFailures={data?.partialFailures ?? []}
          activeIndex={safeActiveIndex}
          isFetching={isFetching}
          onNavigate={navigateTo}
        />
      )}
    </div>
  );
}
