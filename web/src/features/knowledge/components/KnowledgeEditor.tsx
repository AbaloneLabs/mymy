import { useState, type ReactNode } from "react";
import { Check, Eye, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FlatNode } from "@/features/knowledge/utils";
import type { KnowledgeNodeType } from "@/types/knowledge";

interface EditorProps {
  draftTitle: string;
  draftContent: string;
  draftSlug: string;
  draftExcerpt: string;
  draftTags: string;
  draftNodeType: KnowledgeNodeType;
  draftParentId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  parentOptions: FlatNode[];
  currentId: string | null;
  onTitle: (v: string) => void;
  onContent: (v: string) => void;
  onSlug: (v: string) => void;
  onExcerpt: (v: string) => void;
  onTags: (v: string) => void;
  onParentId: (v: string | null) => void;
  onDone: () => void;
}

export function Editor(props: EditorProps) {
  const { t } = useTranslation();
  const [showPreview, setShowPreview] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-6 py-3">
        <div className="min-w-[80px] text-right">
          {props.saveStatus === "saving" && (
            <span className="text-xs text-[var(--text-muted)]">{t("knowledge.saving")}</span>
          )}
          {props.saveStatus === "saved" && (
            <span className="text-xs text-[var(--status-active)]">{t("knowledge.saved")}</span>
          )}
          {props.saveStatus === "error" && (
            <span className="text-xs text-[var(--status-error)]">{t("knowledge.saveError")}</span>
          )}
        </div>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={showPreview ? t("knowledge.write") : t("knowledge.preview")}
        >
          {showPreview ? <Pencil size={13} /> : <Eye size={13} />}
          {showPreview ? t("knowledge.write") : t("knowledge.preview")}
        </button>
        <button
          onClick={props.onDone}
          className="flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white transition-colors hover:opacity-90"
        >
          <Check size={13} />
          {t("common.save")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-[var(--border)] px-6 py-3">
        <Field label={t("knowledge.titlePlaceholder")}>
          <input
            value={props.draftTitle}
            onChange={(e) => props.onTitle(e.target.value)}
            placeholder={t("knowledge.titlePlaceholder")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </Field>
        <Field label={t("knowledge.parent")}>
          <select
            value={props.draftParentId ?? ""}
            onChange={(e) => props.onParentId(e.target.value || null)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">{t("knowledge.none")}</option>
            {props.parentOptions
              .filter((o) => o.id !== props.currentId && o.nodeType === "category")
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {"  ".repeat(o.depth)}
                  {o.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("knowledge.tags")}>
          <input
            value={props.draftTags}
            onChange={(e) => props.onTags(e.target.value)}
            placeholder={t("knowledge.tagsPlaceholder")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        </Field>
        <div className="col-span-2">
          <Field label={t("knowledge.excerpt")}>
            <input
              value={props.draftExcerpt}
              onChange={(e) => props.onExcerpt(e.target.value)}
              placeholder={t("knowledge.excerpt")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
            />
          </Field>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {props.draftNodeType === "category" ? (
          <div />
        ) : showPreview ? (
          <div className="h-full overflow-y-auto px-8 py-6">
            <div className="knowledge-prose mx-auto max-w-3xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {props.draftContent || ""}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <textarea
            value={props.draftContent}
            onChange={(e) => props.onContent(e.target.value)}
            placeholder=""
            className="m-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-4 font-mono text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] focus:outline-none"
          />
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[var(--text-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
