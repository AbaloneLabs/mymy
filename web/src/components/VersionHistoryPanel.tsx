import { useState } from "react";
import { X, History as HistoryIcon, RotateCcw, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEntityVersions, useEntityVersion, useRestoreVersion } from "@/features/versions/api";
import type { EntitySnapshot, NoteSnapshot, KnowledgeArticleSnapshot } from "@/types/versions";

interface VersionHistoryPanelProps {
  /** Entity type: "note" | "knowledge_article". */
  entityType: string;
  /** The entity whose history is shown. */
  entityId: string;
  /** Current entity state — used as the "new" side of the diff. */
  current: EntitySnapshot;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called after a successful restore with the restored snapshot. */
  onRestored: (restored: EntitySnapshot) => void;
}

/**
 * Version history panel for any versioned entity (note, knowledge article).
 *
 * Left: timeline of version summaries (newest-first).
 * Right: Preview / Diff tabs for the selected version, with a Restore button.
 *
 * The diff is computed client-side (line-based) against the current entity
 * state — no backend diff endpoint required.
 */
export function VersionHistoryPanel({
  entityType,
  entityId,
  current,
  onClose,
  onRestored,
}: VersionHistoryPanelProps) {
  const { t } = useTranslation();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [tab, setTab] = useState<"preview" | "diff">("diff");
  const [confirming, setConfirming] = useState(false);

  const versions = useEntityVersions(entityType, entityId);
  const detail = useEntityVersion(selectedVersionId);
  const restore = useRestoreVersion();

  // Auto-select the newest version on first load.
  const firstVersion = versions.data?.versions[0];
  if (!selectedVersionId && firstVersion) {
    setSelectedVersionId(firstVersion.id);
  }

  const snapshot = detail.data?.version.snapshot;
  const selectedSummary = versions.data?.versions.find(
    (v) => v.id === selectedVersionId,
  );

  function handleRestore() {
    if (!selectedVersionId) return;
    restore.mutate(
      { versionId: selectedVersionId },
      {
        onSuccess: (res) => {
          if (entityType === "note" && res.note) {
            onRestored({
              title: res.note.title,
              content: res.note.content,
              tags: res.note.tags,
              pinned: res.note.pinned,
              projectId: res.note.projectId,
            } as NoteSnapshot);
          } else if (entityType === "knowledge_article" && res.article) {
            onRestored({
              title: res.article.title,
              slug: res.article.slug,
              content: res.article.content,
              excerpt: res.article.excerpt,
              tags: res.article.tags,
              status: res.article.status,
              nodeType: res.article.nodeType,
              parentId: res.article.parentId,
              projectId: res.article.projectId,
              sortOrder: res.article.sortOrder,
            } as KnowledgeArticleSnapshot);
          }
          setConfirming(false);
          onClose();
        },
      },
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-full max-w-3xl flex-col bg-[var(--surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <HistoryIcon size={16} className="text-[var(--text-dim)]" />
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {t("notes.versionHistory")}
          </h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title={t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: timeline + detail */}
        <div className="flex min-h-0 flex-1">
          {/* Timeline */}
          <div className="w-[240px] shrink-0 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            {versions.isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--text-dim)]">
                <Loader2 size={14} className="mr-2 animate-spin" />
                {t("common.loading")}
              </div>
            ) : (versions.data?.versions.length ?? 0) === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-[var(--text-dim)]">
                {t("notes.noVersions")}
              </div>
            ) : (
              <ul className="space-y-1">
                {versions.data?.versions.map((v, idx) => (
                  <li key={v.id}>
                    <button
                      onClick={() => setSelectedVersionId(v.id)}
                      className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                        selectedVersionId === v.id
                          ? "bg-[var(--surface-hover)]"
                          : "hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            idx === 0
                              ? "bg-[var(--accent)]"
                              : "bg-[var(--text-dim)]"
                          }`}
                        />
                        <span className="text-xs font-medium text-[var(--text)]">
                          v{v.versionNum}
                          {idx === 0 && (
                            <span className="ml-1.5 text-[10px] text-[var(--accent)]">
                              {t("notes.currentVersion")}
                            </span>
                          )}
                        </span>
                        <span className="ml-auto text-[10px] text-[var(--text-dim)]">
                          {formatRelative(v.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-[var(--text-dim)]">
                        {v.changeSummary}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail */}
          <div className="flex min-w-0 flex-1 flex-col">
            {detail.isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--text-dim)]">
                <Loader2 size={14} className="mr-2 animate-spin" />
                {t("common.loading")}
              </div>
            ) : !snapshot ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--text-dim)]">
                {t("notes.noVersions")}
              </div>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex items-center gap-1 border-b border-[var(--border)] px-4 py-2">
                  <TabButton
                    active={tab === "diff"}
                    onClick={() => setTab("diff")}
                  >
                    {t("notes.diff")}
                  </TabButton>
                  <TabButton
                    active={tab === "preview"}
                    onClick={() => setTab("preview")}
                  >
                    {t("notes.preview")}
                  </TabButton>
                  <span className="ml-auto text-xs text-[var(--text-dim)]">
                    {selectedSummary
                      ? `v${selectedSummary.versionNum}`
                      : ""}
                  </span>
                </div>

                {/* Content */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {tab === "preview" ? (
                    <PreviewView snapshot={snapshot} entityType={entityType} />
                  ) : (
                    <DiffView old={snapshot} current={current} entityType={entityType} />
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
                  {confirming ? (
                    <>
                      <span className="mr-auto text-xs text-[var(--text-dim)]">
                        {t("notes.restoreConfirm")}
                      </span>
                      <button
                        onClick={() => setConfirming(false)}
                        className="rounded-md px-3 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        onClick={handleRestore}
                        disabled={restore.isPending}
                        className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        {restore.isPending ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                        {t("notes.restore")}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirming(true)}
                      className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <RotateCcw size={13} />
                      {t("notes.restoreVersion")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- sub-components ----

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-dim)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

/** Read-only preview of a snapshot's content. */
function PreviewView({
  snapshot,
  entityType,
}: {
  snapshot: EntitySnapshot;
  entityType: string;
}) {
  const { t } = useTranslation();
  const isKnowledge = entityType === "knowledge_article";
  const ksnap = snapshot as KnowledgeArticleSnapshot;
  const nsnap = snapshot as NoteSnapshot;
  return (
    <div className="space-y-3">
      <Field label={isKnowledge ? t("knowledge.title") : t("notes.fieldTitle")}>
        <span className="text-sm text-[var(--text)]">
          {(isKnowledge ? ksnap.title : nsnap.title) || t("notes.untitled")}
        </span>
      </Field>
      {isKnowledge && (
        <Field label={t("knowledge.slug")}>
          <span className="text-xs text-[var(--text-dim)]">{ksnap.slug || "—"}</span>
        </Field>
      )}
      <Field label={t("notes.fieldTags")}>
        <div className="flex flex-wrap gap-1">
          {snapshot.tags.length === 0 ? (
            <span className="text-xs text-[var(--text-dim)]">—</span>
          ) : (
            snapshot.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]"
              >
                {tag}
              </span>
            ))
          )}
        </div>
      </Field>
      {!isKnowledge && (
        <Field label={t("notes.fieldPinned")}>
          <span className="text-xs text-[var(--text-dim)]">
            {nsnap.pinned ? "true" : "false"}
          </span>
        </Field>
      )}
      <Field label={t("notes.fieldContent")}>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-[var(--bg)] p-3 text-xs leading-relaxed text-[var(--text)]">
          {snapshot.content || t("notes.noContent")}
        </pre>
      </Field>
    </div>
  );
}

/** Line-based diff between a snapshot (old) and the current note (new). */
/** Line-based diff between a snapshot (old) and the current entity (new). */
function DiffView({
  old,
  current,
  entityType,
}: {
  old: EntitySnapshot;
  current: EntitySnapshot;
  entityType: string;
}) {
  const { t } = useTranslation();
  const isKnowledge = entityType === "knowledge_article";
  const oldK = old as KnowledgeArticleSnapshot;
  const newK = current as KnowledgeArticleSnapshot;
  const oldN = old as NoteSnapshot;
  const newN = current as NoteSnapshot;
  return (
    <div className="space-y-3">
      {/* Scalar field diffs */}
      <Field label={isKnowledge ? t("knowledge.title") : t("notes.fieldTitle")}>
        <ScalarDiff oldVal={old.title} newVal={current.title} />
      </Field>
      {isKnowledge && (
        <Field label={t("knowledge.slug")}>
          <ScalarDiff oldVal={oldK.slug} newVal={newK.slug} />
        </Field>
      )}
      <Field label={t("notes.fieldTags")}>
        <TagsDiff oldTags={old.tags} newTags={current.tags} />
      </Field>
      {!isKnowledge && (
        <Field label={t("notes.fieldPinned")}>
          <ScalarDiff
            oldVal={String(oldN.pinned)}
            newVal={String(newN.pinned)}
          />
        </Field>
      )}
      {/* Content line diff */}
      <Field label={t("notes.fieldContent")}>
        <LineDiff oldText={old.content} newText={current.content} />
      </Field>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Show old/new values with red/green highlighting when they differ. */
function ScalarDiff({
  oldVal,
  newVal,
}: {
  oldVal: string;
  newVal: string;
}) {
  if (oldVal === newVal) {
    return <span className="text-xs text-[var(--text-dim)]">{newVal}</span>;
  }
  return (
    <div className="space-y-0.5 text-xs">
      <div className="rounded bg-[var(--status-error)]/10 px-2 py-0.5 text-[var(--status-error)]">
        - {oldVal || "(empty)"}
      </div>
      <div className="rounded bg-[var(--status-active)]/10 px-2 py-0.5 text-[var(--status-active)]">
        + {newVal || "(empty)"}
      </div>
    </div>
  );
}

/** Show added/removed tags. */
function TagsDiff({
  oldTags,
  newTags,
}: {
  oldTags: string[];
  newTags: string[];
}) {
  const removed = oldTags.filter((t) => !newTags.includes(t));
  const added = newTags.filter((t) => !oldTags.includes(t));
  if (removed.length === 0 && added.length === 0) {
    return <span className="text-xs text-[var(--text-dim)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {removed.map((tag) => (
        <span
          key={`r-${tag}`}
          className="rounded bg-[var(--status-error)]/10 px-1.5 py-0.5 text-[var(--status-error)]"
        >
          - {tag}
        </span>
      ))}
      {added.map((tag) => (
        <span
          key={`a-${tag}`}
          className="rounded bg-[var(--status-active)]/10 px-1.5 py-0.5 text-[var(--status-active)]"
        >
          + {tag}
        </span>
      ))}
    </div>
  );
}

/**
 * Minimal LCS-based line diff. Renders removed lines in red and added
 * lines in green, unchanged lines in muted text.
 */
function LineDiff({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff = lcsDiff(oldLines, newLines);

  if (diff.length === 0) {
    return <span className="text-xs text-[var(--text-dim)]">—</span>;
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-[var(--bg)] p-2 text-xs leading-relaxed">
      {diff.map((line, i) => {
        if (line.type === "same") {
          return (
            <div key={i} className="whitespace-pre text-[var(--text-dim)]">
              {"  "}
              {line.text || " "}
            </div>
          );
        }
        if (line.type === "removed") {
          return (
            <div
              key={i}
              className="whitespace-pre bg-[var(--status-error)]/10 text-[var(--status-error)]"
            >
              - {line.text || " "}
            </div>
          );
        }
        return (
          <div
            key={i}
            className="whitespace-pre bg-[var(--status-active)]/10 text-[var(--status-active)]"
          >
            + {line.text || " "}
          </div>
        );
      })}
    </pre>
  );
}

type DiffLine =
  | { type: "same"; text: string }
  | { type: "removed"; text: string }
  | { type: "added"; text: string };

/**
 * Compute a line-level diff using the LCS table. Returns a flat list of
 * same/removed/added lines in order.
 */
function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to produce the diff.
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "same", text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: oldLines[i] });
      i++;
    } else {
      result.push({ type: "added", text: newLines[j] });
      j++;
    }
  }
  while (i < m) {
    result.push({ type: "removed", text: oldLines[i] });
    i++;
  }
  while (j < n) {
    result.push({ type: "added", text: newLines[j] });
    j++;
  }
  return result;
}

/** Format an ISO timestamp as a short relative time string. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}
