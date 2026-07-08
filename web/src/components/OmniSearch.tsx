import {
  type KeyboardEvent as ReactKeyboardEvent,
  useState,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  X,
  Loader2,
} from "lucide-react";
import { OmniSearchDropdown } from "@/components/search/OmniSearchDropdown";
import {
  flattenSearchResults,
  type FlatSearchResult,
} from "@/components/search/omniSearchResults";
import { useOmniSearch } from "@/features/search/api";
import { useProjectContext } from "@/store/projectContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

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
    return flattenSearchResults(data.results);
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

  function navigateTo(result: FlatSearchResult) {
    switch (result.type) {
      case "note":
        navigate("/notes");
        break;
      case "task":
        navigate("/tasks");
        break;
      case "project":
        navigate(`/projects/${result.item.id}`);
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

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
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
      if (sel) navigateTo(sel);
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
        <OmniSearchDropdown
          query={trimmed}
          results={data?.results}
          flatResults={flatResults}
          activeIndex={safeActiveIndex}
          total={total}
          isFetching={isFetching}
          hasResults={hasResults}
          onNavigate={navigateTo}
        />
      )}
    </div>
  );
}
