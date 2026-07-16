import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, HelpCircle, X } from "lucide-react";
import {
  type Decision,
  type DecisionFilters,
  useDecision,
  useDecisions,
  useDismissDecision,
  usePendingDecisionCount,
  useResolveDecision,
} from "@/features/decisions/api";
import { useDecisionDrafts } from "@/store/decisionDrafts";

export function DecisionsInbox({
  filters,
  focusedDecisionId,
}: {
  filters: DecisionFilters;
  focusedDecisionId: string | null;
}) {
  const { t } = useTranslation();
  const decisions = useDecisions(filters);
  const focused = useDecision(focusedDecisionId);
  const pendingCount = usePendingDecisionCount();
  const pages = decisions.data?.pages ?? [];
  const filteredPendingCount = pages[0]?.filteredPendingCount ?? 0;
  const globalPendingCount = pendingCount.data?.count;
  const hiddenPendingCount =
    globalPendingCount === undefined
      ? undefined
      : Math.max(0, globalPendingCount - filteredPendingCount);
  const listed = pages.flatMap((page) => page.decisions);
  const focusedDecision = focused.data?.decision;
  const ordered = focusedDecision
    ? [focusedDecision, ...listed.filter((item) => item.id !== focusedDecision.id)]
    : listed;
  const headingRef = useRef<HTMLHeadingElement>(null);

  function moveFocusAfterApplied(decisionId: string) {
    const currentIndex = ordered.findIndex((item) => item.id === decisionId);
    const next = ordered[currentIndex + 1] ?? ordered[currentIndex - 1];
    window.requestAnimationFrame(() => {
      if (next) {
        document.getElementById(`decision-${next.id}`)?.focus();
      } else {
        headingRef.current?.focus();
      }
    });
  }

  if (decisions.isLoading) return <InboxLoading />;
  if (decisions.isError) return <InboxError message={t("decisions.loadError")} />;

  return (
    <section className="space-y-3" aria-labelledby="decision-inbox-heading">
      <h2 id="decision-inbox-heading" ref={headingRef} tabIndex={-1} className="sr-only">
        {t("decisions.title")}
      </h2>
      {pendingCount.isError && (
        <div role="status" className="text-xs text-[var(--status-warning)]">
          {t("decisions.countUnavailable")}
        </div>
      )}
      {hiddenPendingCount !== undefined && hiddenPendingCount > 0 && (
        <div className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
          {t("decisions.hiddenPending", { count: hiddenPendingCount })}
        </div>
      )}
      {focusedDecisionId && focused.isError && (
        <div role="alert" className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("decisions.focusUnavailable")}
        </div>
      )}
      {ordered.length === 0 ? (
        <InboxEmpty />
      ) : (
        ordered.map((decision) => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            focused={decision.id === focusedDecisionId}
            onApplied={moveFocusAfterApplied}
          />
        ))
      )}
      {decisions.hasNextPage && (
        <button
          type="button"
          disabled={decisions.isFetchingNextPage}
          onClick={() => void decisions.fetchNextPage()}
          className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {decisions.isFetchingNextPage ? t("common.loading") : t("decisions.loadMore")}
        </button>
      )}
    </section>
  );
}

function DecisionCard({
  decision,
  focused,
  onApplied,
}: {
  decision: Decision;
  focused: boolean;
  onApplied: (decisionId: string) => void;
}) {
  const { t } = useTranslation();
  const resolve = useResolveDecision();
  const dismiss = useDismissDecision();
  const targetVersion = decision.createdAt;
  const draft = useDecisionDrafts((state) => state.drafts[decision.id]);
  const answer = draft?.targetVersion === targetVersion ? draft.value : "";
  const setDraft = useDecisionDrafts((state) => state.setDraft);
  const clearDraft = useDecisionDrafts((state) => state.clearDraft);
  const [stale, setStale] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const cardRef = useRef<HTMLElement>(null);
  const choices = Array.isArray(decision.choices)
    ? decision.choices.filter((choice): choice is string => typeof choice === "string")
    : [];
  const pending = decision.status === "pending";
  const busy = resolve.isPending || dismiss.isPending;

  useEffect(() => {
    if (draft && (draft.targetVersion !== targetVersion || !pending)) {
      clearDraft(decision.id);
    }
  }, [clearDraft, decision.id, draft, pending, targetVersion]);

  useEffect(() => {
    if (focused) cardRef.current?.focus();
  }, [focused]);

  async function submit(value: string) {
    if (!value.trim() || busy || !pending) return;
    setStale(false);
    try {
      const result = await resolve.mutateAsync({ id: decision.id, answer: value.trim() });
      if (result.applied) {
        clearDraft(decision.id);
        setAnnouncement(t("decisions.actionApplied"));
        onApplied(decision.id);
      } else {
        setStale(true);
        setAnnouncement(t("decisions.actionStale"));
      }
    } catch {
      setStale(true);
      setAnnouncement(t("decisions.actionStale"));
    }
  }

  async function dismissDecision() {
    if (busy || !pending) return;
    if (decision.suspend && !window.confirm(t("decisions.dismissBlockingConfirm"))) return;
    setStale(false);
    try {
      const result = await dismiss.mutateAsync(decision.id);
      if (result.applied) {
        clearDraft(decision.id);
        setAnnouncement(t("decisions.actionApplied"));
        onApplied(decision.id);
      } else {
        setStale(true);
        setAnnouncement(t("decisions.actionStale"));
      }
    } catch {
      setStale(true);
      setAnnouncement(t("decisions.actionStale"));
    }
  }

  return (
    <article
      ref={cardRef}
      id={`decision-${decision.id}`}
      tabIndex={-1}
      aria-labelledby={`decision-title-${decision.id}`}
      className={`rounded-lg border bg-[var(--surface)] p-4 ${
        focused
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/30"
          : decision.suspend && pending
            ? "border-[var(--status-warning)]/50"
            : "border-[var(--border)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge status={decision.status} />
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 uppercase text-[var(--text-muted)]">
              {decision.kind}
            </span>
            {decision.suspend && (
              <span className="font-medium text-[var(--status-warning)]">
                {t("decisions.blocksRun")}
              </span>
            )}
          </div>
          <h2 id={`decision-title-${decision.id}`} className="mt-2 text-sm font-medium text-[var(--text)]">{decision.question}</h2>
          {decision.context && <p className="mt-2 text-xs text-[var(--text-muted)]">{decision.context}</p>}
          {decision.reason && <p className="mt-1 text-xs text-[var(--text-faint)]">{decision.reason}</p>}
        </div>
        <div className="text-right text-[11px] text-[var(--text-faint)]">
          <div>{new Date(decision.createdAt).toLocaleString()}</div>
          <code className="mt-1 block font-mono">run {decision.runId.slice(0, 8)}</code>
        </div>
      </div>

      {pending && choices.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={busy}
              onClick={() => void submit(choice)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      {pending && choices.length === 0 && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(answer);
          }}
        >
          <input
            value={answer}
            onChange={(event) => setDraft(decision.id, targetVersion, event.target.value)}
            placeholder={t("decisions.answerPlaceholder")}
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
        <div className="mt-3 flex items-center justify-between gap-3">
          {answer && (
            <button
              type="button"
              disabled={busy}
              onClick={() => clearDraft(decision.id)}
              className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {t("decisions.discardDraft")}
            </button>
          )}
          {(resolve.isError || dismiss.isError || stale) && (
            <span className="text-xs text-[var(--status-error)]">{t("decisions.actionError")}</span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void dismissDecision()}
            className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {t("decisions.dismiss")}
          </button>
        </div>
      )}

      {!pending && answer && (
        <button
          type="button"
          onClick={() => clearDraft(decision.id)}
          className="mt-3 text-xs text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          {t("decisions.discardDraft")}
        </button>
      )}
      {decision.answer !== undefined && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--status-success)]">
          <Check className="h-3.5 w-3.5" />
          {t("decisions.answer", {
            answer:
              typeof decision.answer === "string"
                ? decision.answer
                : JSON.stringify(decision.answer),
          })}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
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
      {t(`decisions.status.${status}`)}
    </span>
  );
}

function InboxLoading() {
  return <div className="py-12 text-center text-sm text-[var(--text-faint)]">…</div>;
}

function InboxError({ message }: { message: string }) {
  return <div role="alert" className="py-12 text-center text-sm text-[var(--status-error)]">{message}</div>;
}

function InboxEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <HelpCircle className="h-8 w-8 text-[var(--text-faint)]" />
      <h2 className="mt-3 text-sm font-medium text-[var(--text)]">{t("decisions.emptyTitle")}</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{t("decisions.empty")}</p>
    </div>
  );
}
