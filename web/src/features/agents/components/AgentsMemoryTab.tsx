import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Check, Database, Download, Search, Trash2 } from "lucide-react";
import {
  exportRuntimeMemories,
  useReviewRuntimeMemory,
  useMemoryEmbeddingSettings,
  useMemoryRuntimeSettings,
  useRunSummaries,
  useRuntimeMemories,
  useUpdateMemoryEmbeddingSettings,
  useUpdateMemoryRuntimeSettings,
} from "@/features/agent-ops/api";
import type { AgentMemory, MemoryEmbeddingSettings, MemoryRuntimeSettings } from "@/types/agent-ops";
import { EmptyState, PanelError, PanelLoading } from "./AgentsNativeShared";

export function MemoryTab({ profile }: { profile: string | null }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const memories = useRuntimeMemories(profile, deferredQuery);
  const summaries = useRunSummaries(profile, deferredQuery);
  const review = useReviewRuntimeMemory();
  const embeddingSettings = useMemoryEmbeddingSettings(profile);
  const runtimeSettings = useMemoryRuntimeSettings(profile);

  if (memories.isLoading || summaries.isLoading) return <PanelLoading />;
  if (memories.isError || summaries.isError) {
    return <PanelError message={t("agents.memory.loadError")} />;
  }

  const memoryItems = memories.data?.memories ?? [];
  const recapItems = summaries.data?.summaries ?? [];

  async function downloadExport() {
    if (!profile || exporting) return;
    setExporting(true);
    setExportError(false);
    try {
      const exported = await exportRuntimeMemories(profile);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `mymy-memory-${profile.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="max-w-5xl space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              {t("agents.memory.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("agents.memory.description")}
            </p>
          </div>
          {profile && (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void downloadExport()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? t("agents.memory.exporting") : t("agents.memory.export")}
            </button>
          )}
        </div>
        {exportError && (
          <p role="alert" className="mt-2 text-xs text-[var(--status-error)]">
            {t("agents.memory.exportError")}
          </p>
        )}
        <label className="mt-3 flex max-w-md items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <Search className="h-3.5 w-3.5 text-[var(--text-faint)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("agents.memory.search")}
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none"
          />
        </label>
        {profile && runtimeSettings.data && (
          <RuntimeSettings profile={profile} settings={runtimeSettings.data} />
        )}
        {profile && embeddingSettings.data && runtimeSettings.data && (
          <SemanticSettings
            profile={profile}
            settings={embeddingSettings.data}
            semanticEnabled={runtimeSettings.data.semanticIndexingEnabled}
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t("agents.memory.durable")}
        </h3>
        {memoryItems.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("agents.memory.emptyTitle")}
            message={t("agents.memory.empty")}
          />
        ) : (
          memoryItems.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              busy={review.isPending}
              onReview={(action) =>
                review.mutate({
                  id: memory.id,
                  action,
                  expectedContentRevision: memory.contentRevision,
                  expectedLifecycleRevision: memory.lifecycleRevision,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t("agents.memory.recaps")}
        </h3>
        {recapItems.length === 0 ? (
          <p className="text-xs text-[var(--text-faint)]">
            {t("agents.memory.noRecaps")}
          </p>
        ) : (
          recapItems.map((summary) => (
            <article
              key={summary.runId}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-faint)]">
                <span>{summary.agentProfile}</span>
                <span>{new Date(summary.createdAt).toLocaleString()}</span>
              </div>
              <h4 className="mt-2 text-sm font-medium text-[var(--text)]">
                {summary.objective}
              </h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {summary.summaryText}
              </p>
              <a
                href={`?tab=overview&runId=${encodeURIComponent(summary.runId)}`}
                className="mt-2 block font-mono text-[11px] text-[var(--accent)] hover:underline"
              >
                {t("agents.memory.sourceRun", {
                  run: summary.runId,
                  start: summary.sourceEventStart ?? "-",
                  end: summary.sourceEventEnd ?? "-",
                })}
              </a>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function RuntimeSettings({
  profile,
  settings,
}: {
  profile: string;
  settings: MemoryRuntimeSettings;
}) {
  const { t } = useTranslation();
  const update = useUpdateMemoryRuntimeSettings(profile);
  return (
    <div className="mt-3 max-w-2xl rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <label className="flex items-center gap-2 text-xs text-[var(--text)]">
        <input
          type="checkbox"
          checked={settings.automaticRecallEnabled}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({
              automaticRecallEnabled: event.target.checked,
              inferredExtractionEnabled: settings.inferredExtractionEnabled,
              semanticIndexingEnabled: settings.semanticIndexingEnabled,
              expectedSettingsRevision: settings.settingsRevision,
            })
          }
        />
        {t("agents.memory.automaticRecall")}
      </label>
      <p className="mt-1 text-[11px] text-[var(--text-faint)]">
        {t("agents.memory.automaticRecallDescription")}
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text)]">
        <input
          type="checkbox"
          checked={settings.inferredExtractionEnabled}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({
              automaticRecallEnabled: settings.automaticRecallEnabled,
              inferredExtractionEnabled: event.target.checked,
              semanticIndexingEnabled: settings.semanticIndexingEnabled,
              expectedSettingsRevision: settings.settingsRevision,
            })
          }
        />
        {t("agents.memory.inferredExtraction")}
      </label>
      <p className="mt-1 text-[11px] text-[var(--text-faint)]">
        {t("agents.memory.inferredExtractionDescription")}
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text)]">
        <input
          type="checkbox"
          checked={settings.semanticIndexingEnabled}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({
              automaticRecallEnabled: settings.automaticRecallEnabled,
              inferredExtractionEnabled: settings.inferredExtractionEnabled,
              semanticIndexingEnabled: event.target.checked,
              expectedSettingsRevision: settings.settingsRevision,
            })
          }
        />
        {t("agents.memory.semanticIndexing")}
      </label>
      <p className="mt-1 text-[11px] text-[var(--text-faint)]">
        {t("agents.memory.semanticIndexingDescription")}
      </p>
      {update.isError && (
        <p role="alert" className="mt-1 text-[11px] text-[var(--status-error)]">
          {t("agents.memory.settingsChanged")}
        </p>
      )}
    </div>
  );
}

function SemanticSettings({
  profile,
  settings,
  semanticEnabled,
}: {
  profile: string;
  settings: MemoryEmbeddingSettings;
  semanticEnabled: boolean;
}) {
  const { t } = useTranslation();
  const update = useUpdateMemoryEmbeddingSettings(profile);

  function save(patch: Partial<{
    includePrivate: boolean;
    includeFinancial: boolean;
  }>) {
    update.mutate({
      includePrivate: settings.includePrivate,
      includeFinancial: settings.includeFinancial,
      ...patch,
    });
  }

  return (
    <div className="mt-3 max-w-2xl rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="mt-1 text-[11px] text-[var(--text-faint)]">
        {t("agents.memory.semanticDisclosure", { provider: settings.provider })}
      </p>
      {semanticEnabled && (
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-[var(--text-muted)]">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={settings.includePrivate}
              disabled={update.isPending}
              onChange={(event) => save({ includePrivate: event.target.checked })}
            />
            {t("agents.memory.includePrivate")}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={settings.includeFinancial}
              disabled={update.isPending}
              onChange={(event) => save({ includeFinancial: event.target.checked })}
            />
            {t("agents.memory.includeFinancial")}
          </label>
        </div>
      )}
    </div>
  );
}

function MemoryCard({
  memory,
  busy,
  onReview,
}: {
  memory: AgentMemory;
  busy: boolean;
  onReview: (action: "approve" | "stale" | "delete") => void;
}) {
  const { t } = useTranslation();
  const reviewable = memory.status === "pending_review" || memory.status === "conflict";
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--text-muted)]">
              {t(`agents.memory.status.${memory.status}`)}
            </span>
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--text-muted)]">
              {memory.memoryType}
            </span>
            <span className="text-[var(--text-faint)]">
              {Math.round(memory.confidence * 100)}%
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text)]">
            {memory.content}
          </p>
          {memory.sourceRunId ? (
            <a
              href={`?tab=overview&runId=${encodeURIComponent(memory.sourceRunId)}`}
              className="mt-2 block font-mono text-[11px] text-[var(--accent)] hover:underline"
            >
              {t("agents.memory.source", { run: memory.sourceRunId })}
            </a>
          ) : memory.sourceRunSnapshotId ? (
            <code className="mt-2 block text-[11px] text-[var(--status-warning)]">
              {t("agents.memory.sourceUnavailable", {
                run: memory.sourceRunSnapshotId,
              })}
            </code>
          ) : (
            <code className="mt-2 block text-[11px] text-[var(--text-faint)]">
              {t("agents.memory.noSource")}
            </code>
          )}
        </div>
        <span className="text-[11px] text-[var(--text-faint)]">
          {new Date(memory.createdAt).toLocaleString()}
        </span>
      </div>
      {memory.status !== "deleted" && memory.status !== "superseded" && (
        <div className="mt-3 flex justify-end gap-2">
          {reviewable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview("approve")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--status-success)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {t("agents.memory.approve")}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview("stale")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {t("agents.memory.stale")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview("delete")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--status-error)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("common.delete")}
          </button>
        </div>
      )}
    </article>
  );
}
