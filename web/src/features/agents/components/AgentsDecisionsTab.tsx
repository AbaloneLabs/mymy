import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, HelpCircle, X } from "lucide-react";
import {
  type Decision,
  useDecisions,
  useDismissDecision,
  useResolveDecision,
} from "@/features/decisions/api";
import { EmptyState, PanelError, PanelLoading } from "./AgentsNativeShared";

export function DecisionsTab({ profile }: { profile: string | null }) {
  const { t } = useTranslation();
  const decisions = useDecisions(profile);
  const ordered = useMemo(
    () =>
      [...(decisions.data?.decisions ?? [])].sort((left, right) => {
        const leftPending = left.status === "pending" ? 0 : 1;
        const rightPending = right.status === "pending" ? 0 : 1;
        return leftPending - rightPending || right.createdAt.localeCompare(left.createdAt);
      }),
    [decisions.data?.decisions],
  );

  if (decisions.isLoading) return <PanelLoading />;
  if (decisions.isError) {
    return <PanelError message={t("agents.decisions.loadError")} />;
  }
  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={HelpCircle}
        title={t("agents.decisions.emptyTitle")}
        message={t("agents.decisions.empty")}
      />
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text)]">
          {t("agents.decisions.title")}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("agents.decisions.description")}
        </p>
      </div>
      {ordered.map((decision) => (
        <DecisionCard key={decision.id} decision={decision} />
      ))}
    </section>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const { t } = useTranslation();
  const resolve = useResolveDecision();
  const dismiss = useDismissDecision();
  const [answer, setAnswer] = useState("");
  const choices = Array.isArray(decision.choices)
    ? decision.choices.filter((choice): choice is string => typeof choice === "string")
    : [];
  const pending = decision.status === "pending";
  const busy = resolve.isPending || dismiss.isPending;

  function submit(value: string) {
    if (!value.trim() || busy) return;
    resolve.mutate({ id: decision.id, answer: value.trim() });
  }

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge status={decision.status} />
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 uppercase text-[var(--text-muted)]">
              {decision.kind}
            </span>
            {decision.suspend && (
              <span className="text-[var(--status-warning)]">
                {t("agents.decisions.blocksRun")}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-sm font-medium text-[var(--text)]">
            {decision.question}
          </h3>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {decision.context}
          </p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            {decision.reason}
          </p>
        </div>
        <div className="text-right text-[11px] text-[var(--text-faint)]">
          <div>{new Date(decision.createdAt).toLocaleString()}</div>
          <code className="mt-1 block font-mono">run {decision.runId.slice(0, 8)}</code>
        </div>
      </div>

      {decision.targetVersion && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--status-warning)]">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("agents.decisions.targetVersion", {
            version: decision.targetVersion,
          })}
        </div>
      )}

      {pending && choices.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={busy}
              onClick={() => submit(choice)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {choice === "approve"
                ? t("agents.decisions.approve")
                : choice === "reject"
                  ? t("agents.decisions.reject")
                  : choice}
            </button>
          ))}
        </div>
      )}

      {pending && choices.length === 0 && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(answer);
          }}
        >
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={t("agents.decisions.answerPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={busy || !answer.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {t("common.submit")}
          </button>
        </form>
      )}

      {pending && (
        <div className="mt-3 flex items-center justify-between">
          {(resolve.isError || dismiss.isError) && (
            <span className="text-xs text-[var(--status-error)]">
              {t("agents.decisions.actionError")}
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => dismiss.mutate(decision.id)}
            className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {t("agents.decisions.dismiss")}
          </button>
        </div>
      )}

      {decision.answer !== undefined && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--status-success)]">
          <Check className="h-3.5 w-3.5" />
          {t("agents.decisions.answer", {
            answer:
              typeof decision.answer === "string"
                ? decision.answer
                : JSON.stringify(decision.answer),
          })}
        </div>
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const pending = status === "pending";
  return (
    <span
      className={
        pending
          ? "inline-flex items-center gap-1 rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[var(--status-warning)]"
          : "inline-flex items-center gap-1 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--text-muted)]"
      }
    >
      {pending ? <HelpCircle className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {t(`agents.decisions.status.${status}`)}
    </span>
  );
}
