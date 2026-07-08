import { useState } from "react";
import { History as HistoryIcon, Loader2, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEntityVersion, useEntityVersions, useRestoreVersion } from "@/features/versions/api";
import type { EntitySnapshot, KnowledgeArticleSnapshot, NoteSnapshot } from "@/types/versions";
import { DiffView, PreviewView } from "./versionHistoryDiff";
import { VersionHistoryTimeline } from "./versionHistoryTimeline";

interface VersionHistoryPanelProps {
  entityType: string;
  entityId: string;
  current: EntitySnapshot;
  onClose: () => void;
  onRestored: (restored: EntitySnapshot) => void;
}

export function VersionHistoryPanel({
  entityType,
  entityId,
  current,
  onClose,
  onRestored,
}: VersionHistoryPanelProps) {
  const { t } = useTranslation();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "diff">("diff");
  const [confirming, setConfirming] = useState(false);

  const versions = useEntityVersions(entityType, entityId);
  const restore = useRestoreVersion();
  const versionItems = versions.data?.versions ?? [];
  const firstVersionId = versionItems[0]?.id ?? null;
  const effectiveVersionId = selectedVersionId ?? firstVersionId;
  const detail = useEntityVersion(effectiveVersionId);
  const snapshot = detail.data?.version.snapshot;
  const selectedSummary = versionItems.find((version) => version.id === effectiveVersionId);

  function handleRestore() {
    if (!effectiveVersionId) return;
    restore.mutate(
      { versionId: effectiveVersionId },
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div className="relative ml-auto flex h-full w-full max-w-3xl flex-col bg-[var(--surface)] shadow-2xl">
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

        <div className="flex min-h-0 flex-1">
          <div className="w-[240px] shrink-0 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            <VersionHistoryTimeline
              versions={versionItems}
              loading={versions.isLoading}
              selectedVersionId={effectiveVersionId}
              onSelect={setSelectedVersionId}
            />
          </div>

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
                <div className="flex items-center gap-1 border-b border-[var(--border)] px-4 py-2">
                  <TabButton active={tab === "diff"} onClick={() => setTab("diff")}>
                    {t("notes.diff")}
                  </TabButton>
                  <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
                    {t("notes.preview")}
                  </TabButton>
                  <span className="ml-auto text-xs text-[var(--text-dim)]">
                    {selectedSummary ? `v${selectedSummary.versionNum}` : ""}
                  </span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {tab === "preview" ? (
                    <PreviewView snapshot={snapshot} entityType={entityType} />
                  ) : (
                    <DiffView old={snapshot} current={current} entityType={entityType} />
                  )}
                </div>

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
