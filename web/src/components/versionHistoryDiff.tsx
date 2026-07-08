import { useTranslation } from "react-i18next";
import type {
  EntitySnapshot,
  KnowledgeArticleSnapshot,
  NoteSnapshot,
} from "@/types/versions";

export function PreviewView({
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
          <span className="text-xs text-[var(--text-dim)]">{ksnap.slug || "-"}</span>
        </Field>
      )}
      <Field label={t("notes.fieldTags")}>
        <div className="flex flex-wrap gap-1">
          {snapshot.tags.length === 0 ? (
            <span className="text-xs text-[var(--text-dim)]">-</span>
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

export function DiffView({
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

function TagsDiff({
  oldTags,
  newTags,
}: {
  oldTags: string[];
  newTags: string[];
}) {
  const removed = oldTags.filter((tag) => !newTags.includes(tag));
  const added = newTags.filter((tag) => !oldTags.includes(tag));
  if (removed.length === 0 && added.length === 0) {
    return <span className="text-xs text-[var(--text-dim)]">-</span>;
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
    return <span className="text-xs text-[var(--text-dim)]">-</span>;
  }

  return (
    <pre className="overflow-x-auto rounded-md bg-[var(--bg)] p-2 text-xs leading-relaxed">
      {diff.map((line, index) => {
        if (line.type === "same") {
          return (
            <div key={index} className="whitespace-pre text-[var(--text-dim)]">
              {"  "}
              {line.text || " "}
            </div>
          );
        }
        if (line.type === "removed") {
          return (
            <div
              key={index}
              className="whitespace-pre bg-[var(--status-error)]/10 text-[var(--status-error)]"
            >
              - {line.text || " "}
            </div>
          );
        }
        return (
          <div
            key={index}
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

function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "same", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: oldLines[i] });
      i += 1;
    } else {
      result.push({ type: "added", text: newLines[j] });
      j += 1;
    }
  }
  while (i < m) {
    result.push({ type: "removed", text: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    result.push({ type: "added", text: newLines[j] });
    j += 1;
  }
  return result;
}
