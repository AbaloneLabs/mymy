import { useState } from "react";
import {
  GitBranch,
  Loader2,
  Network,
  Pin,
  Save,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type JourneyNode,
  useDeleteJourneyNode,
  useUpdateJourneyNode,
} from "@/features/journey/api";
import { JourneyNodeIcon } from "./JourneyNodeIcon";
import { formatJourneyDate } from "./journeyViewUtils";

export function JourneyDetail({
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
            <JourneyNodeIcon node={node} />
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
        <DetailItem
          label={t("journey.updated")}
          value={formatJourneyDate(node.timestamp)}
        />
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
      ) : (
        (node.description || node.content) && (
          <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
              {node.content || node.description}
            </p>
          </div>
        )
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
