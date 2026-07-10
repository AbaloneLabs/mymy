import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { File, Link2, Trash2, Unlink } from "lucide-react";
import {
  useAttachKnowledgeResource,
  useDetachKnowledgeResource,
  useKnowledgeResources,
} from "@/features/knowledge/api";

export function KnowledgeResourcesPanel({ knowledgeId }: { knowledgeId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [path, setPath] = useState("");
  const resources = useKnowledgeResources(knowledgeId);
  const attach = useAttachKnowledgeResource();
  const detach = useDetachKnowledgeResource();
  const items = resources.data?.resources ?? [];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const resourceRef = path.trim();
    if (!resourceRef) return;
    attach.mutate(
      { knowledgeId, resourceRef },
      { onSuccess: () => setPath("") },
    );
  }

  return (
    <section className="mx-auto mt-8 max-w-3xl border-t border-[var(--border)] pt-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[var(--text-faint)]" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t("knowledge.resources.title")}
        </h2>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={submit}>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={t("knowledge.resources.pathPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={attach.isPending || !path.trim()}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {t("knowledge.resources.attach")}
        </button>
      </form>
      {attach.isError && (
        <p className="mt-2 text-xs text-[var(--status-error)]">
          {t("knowledge.resources.attachError")}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-faint)]">
          {t("knowledge.resources.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((resource) => (
            <div
              key={resource.id}
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              {resource.status === "broken" ? (
                <Unlink className="h-4 w-4 shrink-0 text-[var(--status-error)]" />
              ) : (
                <File className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
              )}
              <button
                type="button"
                disabled={resource.status === "broken"}
                onClick={() =>
                  navigate(`/drive?file=${encodeURIComponent(resource.resourceRef)}`)
                }
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
              >
                <span className="block truncate text-xs font-medium text-[var(--text)]">
                  {resource.title}
                </span>
                <span className="block truncate font-mono text-[10px] text-[var(--text-faint)]">
                  {resource.resourceRef}
                </span>
              </button>
              <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {resource.status === "broken"
                  ? t("knowledge.resources.broken")
                  : resource.editorKind}
              </span>
              <button
                type="button"
                disabled={detach.isPending}
                onClick={() =>
                  detach.mutate({ knowledgeId, resourceId: resource.id })
                }
                title={t("knowledge.resources.detach")}
                className="rounded p-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
