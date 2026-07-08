import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/types/settings";
import { useFetchModels } from "@/features/llm-providers/api";
import { cn } from "@/lib/utils";

interface ModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  /** Credentials used to fetch the live model list. */
  baseUrl: string;
  apiKey: string;
  apiFormat: "openai" | "anthropic" | "auto";
}

/**
 * Searchable model dropdown with 3-tier fallback:
 * 1. Live API (GET /models via backend proxy)
 * 2. Curated presets (returned by backend when live fails)
 * 3. Manual text entry (always available)
 *
 * Auto-fetches when both baseUrl and apiKey are non-empty.
 */
export function ModelSelect({
  value,
  onChange,
  baseUrl,
  apiKey,
  apiFormat,
}: ModelSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchModels = useFetchModels();

  const hasCredentials = baseUrl.trim() && apiKey.trim();

  // Debounced auto-fetch when credentials become available.
  useEffect(() => {
    if (!hasCredentials) return;
    const timer = setTimeout(() => {
      fetchModels.mutate({
        base_url: baseUrl,
        api_key: apiKey,
        api_format: apiFormat,
      });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey, apiFormat]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const models = fetchModels.data?.models ?? [];
  const source = fetchModels.data?.source;
  const isLoading = fetchModels.isPending;
  // isError is true when the backend reports an error source OR the
  // mutation itself failed (HTTP error, network error, etc.). In the
  // latter case `data` is undefined so `source` is also undefined.
  const isError = source === "error" || fetchModels.isError;

  // Filter models by search query.
  const filtered = query.trim()
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(query.toLowerCase()) ||
          m.display_name.toLowerCase().includes(query.toLowerCase()),
      )
    : models;

  // Split curated vs live for display.
  const curated = filtered.filter((m) => m.is_curated);
  const live = filtered.filter((m) => !m.is_curated);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    setManualMode(false);
  };

  if (manualMode) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("settings.models.modelPlaceholder")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none transition-colors duration-150 placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => setManualMode(false)}
          className="shrink-0 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.done")}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none transition-colors duration-150 hover:border-[var(--text-faint)] focus:border-[var(--accent)]"
      >
        <span className={cn(value ? "" : "text-[var(--text-faint)]")}>
          {value || t("settings.models.modelPlaceholder")}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-lg">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5">
            <Search
              className="h-3.5 w-3.5 text-[var(--text-faint)]"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder={t("settings.models.searchPlaceholder")}
              className="w-full bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
          </div>

          {/* List */}
          <div className="max-h-52 overflow-y-auto">
            {isLoading && (
              <div className="px-2.5 py-3 text-center text-xs text-[var(--text-muted)]">
                {t("common.loading")}
              </div>
            )}

            {!isLoading && isError && models.length === 0 && (
              <div className="px-2.5 py-3 text-center text-xs text-[var(--text-muted)]">
                {t("settings.models.fetchError")}
              </div>
            )}

            {!isLoading && !isError && models.length === 0 && !hasCredentials && (
              <div className="px-2.5 py-3 text-center text-xs text-[var(--text-muted)]">
                {t("settings.models.enterCredentialsFirst")}
              </div>
            )}

            {/* Curated section */}
            {curated.length > 0 && (
              <>
                <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  {t("settings.models.curated")}
                </div>
                {curated.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    selected={m.id === value}
                    onSelect={handleSelect}
                  />
                ))}
              </>
            )}

            {/* Live section */}
            {live.length > 0 && (
              <>
                <div className="border-t border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                  {t("settings.models.fromApi")}
                </div>
                {live.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    selected={m.id === value}
                    onSelect={handleSelect}
                  />
                ))}
              </>
            )}

            {filtered.length === 0 && query.trim() && (
              <div className="px-2.5 py-3 text-center text-xs text-[var(--text-muted)]">
                {t("settings.models.noResults")}
              </div>
            )}
          </div>

          {/* Manual entry */}
          <button
            type="button"
            onClick={() => {
              setManualMode(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t border-[var(--border)] px-2.5 py-2 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Pencil className="h-3 w-3" strokeWidth={1.5} />
            {t("settings.models.manualEntry")}
          </button>
        </div>
      )}
    </div>
  );
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const hasDisplayName = model.display_name !== model.id;
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--surface-hover)]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-[var(--text)]">
          {model.id}
        </div>
        {hasDisplayName && (
          <div className="truncate text-[10px] text-[var(--text-muted)]">
            {model.display_name}
          </div>
        )}
      </div>
      {selected && (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
          strokeWidth={2}
        />
      )}
    </button>
  );
}
