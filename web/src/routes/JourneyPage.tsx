import { useMemo, useState } from "react";
import {
  Boxes,
  GitBranch,
  Loader2,
  Network,
  Pin,
  Puzzle,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import {
  type JourneyEdge,
  type JourneyNode,
  type JourneyQuery,
  useDeleteJourneyNode,
  useJourney,
  useUpdateJourneyNode,
} from "@/features/journey/api";
import { cn } from "@/lib/utils";

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
        <header className="border-b border-[var(--border)] px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold text-[var(--text)]">
              {t("journey.title")}
            </h1>
            <div className="flex items-center gap-2">
              <Segmented
                value={filter}
                options={[
                  ["all", t("journey.filters.all")],
                  ["skill", t("journey.filters.skills")],
                  ["memory", t("journey.filters.memories")],
                ]}
                onChange={(value) => {
                  setFilter(value as Filter);
                  setSelectedId(null);
                }}
              />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="recent">{t("journey.sort.recent")}</option>
                <option value="usage">{t("journey.sort.usage")}</option>
                <option value="name">{t("journey.sort.name")}</option>
              </select>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
          <div className="relative w-full max-w-lg">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" strokeWidth={1.5} />
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

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            value === option
              ? "bg-[var(--surface-hover)] text-[var(--text)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function JourneyGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = nodes.slice(0, 80);
  const positions = graphPositions(visible);
  return (
    <div className="relative h-72 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <svg className="absolute inset-0 h-full w-full">
        {edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.source}:${edge.target}`}
              x1={`${source.x}%`}
              y1={`${source.y}%`}
              x2={`${target.x}%`}
              y2={`${target.y}%`}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          );
        })}
      </svg>
      {visible.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const Icon = node.type === "skill" ? Puzzle : Boxes;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className={cn(
              "absolute flex max-w-36 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] shadow-sm",
              selectedId === node.id
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]",
            )}
          >
            <Icon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{node.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function JourneyList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: JourneyNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => onSelect(node.id)}
          className={cn(
            "flex w-full items-start gap-3 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)]",
            selectedId === node.id && "bg-[var(--surface-hover)]",
          )}
        >
          <NodeIcon node={node} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-[var(--text)]">
                {node.title}
              </span>
              {node.pinned && <Pin className="h-3 w-3 text-[var(--accent)]" strokeWidth={1.5} />}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
              {node.description || node.content || node.path}
            </span>
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            {node.state}
          </span>
        </button>
      ))}
    </div>
  );
}

function JourneyDetail({
  node,
  focused,
  onFocus,
  onClearFocus,
  onDeleted,
}: {
  node: JourneyNode | null;
  focused: boolean;
  onFocus: (id: string) => void;
  onClearFocus: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const updateMutation = useUpdateJourneyNode();
  const deleteMutation = useDeleteJourneyNode();
  const [content, setContent] = useState(node?.content ?? "");
  if (!node) return null;
  const current = node;

  function togglePin() {
    updateMutation.mutate({
      id: current.id,
      body: { pinned: !current.pinned },
    });
  }

  function saveMemory() {
    updateMutation.mutate({
      id: current.id,
      body: { content },
    });
  }

  function deleteNode() {
    if (!window.confirm(t("journey.deleteConfirm", { title: current.title }))) {
      return;
    }
    deleteMutation.mutate(current.id, { onSuccess: onDeleted });
  }

  return (
    <aside className="min-h-0 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <NodeIcon node={node} />
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {node.type}
            </span>
          </div>
          <h2 className="truncate text-base font-semibold text-[var(--text)]">
            {node.title}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {node.path ?? node.source}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {node.type === "skill" && node.state === "active" && (
            <button
              type="button"
              onClick={togglePin}
              disabled={updateMutation.isPending}
              className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={node.pinned ? t("journey.unpin") : t("journey.pin")}
            >
              <Pin className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() => (focused ? onClearFocus() : onFocus(node.id))}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label={focused ? t("journey.clearFocus") : t("journey.focus")}
          >
            <Network className="h-4 w-4" strokeWidth={1.5} />
          </button>
          {node.state === "active" && (
            <button
              type="button"
              onClick={deleteNode}
              disabled={deleteMutation.isPending}
              className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("journey.delete")}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <DetailItem label={t("journey.source")} value={node.source} />
        <DetailItem label={t("journey.state")} value={node.state} />
        <DetailItem label={t("journey.usage")} value={String(node.useCount)} />
        <DetailItem label={t("journey.updated")} value={formatDate(node.timestamp)} />
      </dl>

      {node.type === "memory" ? (
        <div className="mt-4 space-y-2">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-40 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex items-center justify-end gap-2">
            {updateMutation.isError && (
              <span className="mr-auto text-xs text-[var(--danger)]">
                {t("journey.saveFailed")}
              </span>
            )}
            <button
              type="button"
              onClick={saveMemory}
              disabled={updateMutation.isPending || !content.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {t("journey.save")}
            </button>
          </div>
        </div>
      ) : (node.description || node.content) && (
        <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
            {node.content || node.description}
          </p>
        </div>
      )}

      {node.related.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
            <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("journey.related")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.related.map((related) => (
              <span
                key={related}
                className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
              >
                {related}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 truncate text-[var(--text)]">{value || "-"}</dd>
    </div>
  );
}

function NodeIcon({ node }: { node: JourneyNode }) {
  const Icon = node.type === "skill" ? Puzzle : Boxes;
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-hover)] text-[var(--text-muted)]">
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </span>
  );
}

function graphPositions(nodes: JourneyNode[]) {
  const positions = new Map<string, { x: number; y: number }>();
  const count = Math.max(nodes.length, 1);
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / cols);
  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(node.id, {
      x: ((col + 1) / (cols + 1)) * 100,
      y: ((row + 1) / (rows + 1)) * 100,
    });
  });
  return positions;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
