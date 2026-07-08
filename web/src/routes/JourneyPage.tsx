import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { JourneyDetail } from "@/features/journey/components/JourneyDetail";
import { JourneyGraph } from "@/features/journey/components/JourneyGraph";
import { JourneyHeader } from "@/features/journey/components/JourneyHeader";
import { JourneyList } from "@/features/journey/components/JourneyList";
import {
  type JourneyQuery,
  useJourney,
} from "@/features/journey/api";

type Filter = NonNullable<JourneyQuery["type"]>;
type Sort = NonNullable<JourneyQuery["sort"]>;

export default function JourneyPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const { data, isLoading, isError } = useJourney({
    type: filter,
    sort,
    neighborhood,
  });

  const nodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = data?.nodes ?? [];
    if (!query) return all;
    return all.filter((node) =>
      [node.title, node.description, node.content, node.category, node.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [data?.nodes, search]);
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0] ?? null;
  const edges = data?.edges ?? [];

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <JourneyHeader
          filter={filter}
          sort={sort}
          onFilterChange={(value) => {
            setFilter(value);
            setSelectedId(null);
          }}
          onSortChange={setSort}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
          <div className="relative w-full max-w-lg">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]"
              strokeWidth={1.5}
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("journey.search")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          {isLoading && (
            <div className="flex flex-1 items-center justify-center text-[var(--text-muted)]">
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.5} />
            </div>
          )}

          {!isLoading && isError && (
            <div className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-4 text-sm text-[var(--status-error)]">
              {t("journey.loadError")}
            </div>
          )}

          {!isLoading && !isError && nodes.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]">
              {t("journey.empty")}
            </div>
          )}

          {!isLoading && !isError && nodes.length > 0 && (
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_360px]">
              <div className="flex min-h-0 flex-col gap-4">
                <JourneyGraph
                  nodes={nodes}
                  edges={edges}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
                <JourneyList
                  nodes={nodes}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              </div>
              <JourneyDetail
                key={selected?.id ?? "empty"}
                node={selected}
                focused={neighborhood === selected?.id}
                onFocus={(id) => setNeighborhood(id)}
                onClearFocus={() => setNeighborhood(null)}
                onDeleted={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
