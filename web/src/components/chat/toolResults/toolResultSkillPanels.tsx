import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Puzzle,
} from "lucide-react";
import { CodeBlock } from "../shared/codeHighlight";
import type {
  SkillBundleResult,
  SkillViewResult,
  SkillsListResult,
} from "./toolResultGeneralParsers";
import {
  MiniMeta,
  ToolPanelHeader,
} from "./toolResultShared";
import { stringValue } from "./toolResultUtils";

export function SkillsListResultPanel({
  result,
  status,
}: {
  result: SkillsListResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleSkills = expanded ? result.skills : result.skills.slice(0, 6);
  const hiddenCount = Math.max(result.skills.length - visibleSkills.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Puzzle className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.skillsListTitle")}
        </span>
        <span>{t("chat.skillsListCount", { count: result.count })}</span>
      </div>

      {result.root && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {result.root}
        </div>
      )}
      {result.hint && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {result.hint}
        </div>
      )}
      {result.categories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.categories.map((category) => (
            <span
              key={category}
              className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
            >
              {category}
            </span>
          ))}
        </div>
      )}

      {result.skills.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("chat.skillsListEmpty")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {visibleSkills.map((skill) => (
            <div
              key={`${skill.category}:${skill.name}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="truncate font-mono text-xs text-[var(--text)]">
                {skill.name}
              </div>
              {skill.category && (
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                  {skill.category}
                </div>
              )}
              {skill.description && (
                <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  {skill.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showMoreResults", { count: hiddenCount })}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

export function SkillViewResultPanel({
  result,
  status,
}: {
  result: SkillViewResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const skillName = stringValue(result.skill, "name") || t("chat.skill");
  const filePath = stringValue(result.skill, "file_path", "filePath", "path");
  const content = stringValue(result.skill, "content", "markdown", "body");
  const description = stringValue(result.skill, "description");

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader icon="skill" title={skillName} status={status} />
      {filePath && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {filePath}
        </div>
      )}
      {description && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {description}
        </div>
      )}
      {content && (
        <CodeBlock
          title={filePath?.split("/").pop() || "SKILL.md"}
          content={content}
          language="markdown"
        />
      )}
      {result.usageHint && (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {result.usageHint}
        </div>
      )}
    </div>
  );
}

export function SkillBundleResultPanel({
  result,
  status,
}: {
  result: SkillBundleResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="skill"
        title={t("chat.skillBundleTitle")}
        status={status}
        ok={result.success}
      />
      {result.bundles.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {result.bundles.map((bundle) => (
            <div
              key={bundle.name}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="font-mono text-xs text-[var(--text)]">
                {bundle.name}
              </div>
              {bundle.description && (
                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">
                  {bundle.description}
                </div>
              )}
              {bundle.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {bundle.skills.map((skill) => (
                    <MiniMeta key={skill} value={skill} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {result.bundle && <MiniMeta value={result.bundle} />}
      {result.instruction && (
        <CodeBlock title="instruction.md" content={result.instruction} language="markdown" />
      )}
      {result.message && (
        <CodeBlock title="bundle-message.md" content={result.message} language="markdown" />
      )}
    </div>
  );
}
