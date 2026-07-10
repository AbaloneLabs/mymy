import { useTranslation } from "react-i18next";
import { Lightbulb, ShieldCheck } from "lucide-react";
import {
  useApproveProactiveCandidate,
  useIgnoreProactiveCandidate,
  useProactiveCandidates,
  useProactiveSettings,
  useUpdateProactiveSettings,
} from "@/features/agents/proactiveApi";

export function ProactivePanel({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const settings = useProactiveSettings(profile);
  const candidates = useProactiveCandidates(profile);
  const update = useUpdateProactiveSettings(profile);
  const approve = useApproveProactiveCandidate();
  const ignore = useIgnoreProactiveCandidate();
  const value = settings.data?.settings;
  const discovered = (candidates.data?.candidates ?? []).filter(
    (candidate) => candidate.status === "discovered",
  );

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
            <Lightbulb className="h-4 w-4" />
            {t("agents.proactive.title")}
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("agents.proactive.description")}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={value?.enabled ?? false}
            disabled={!value || update.isPending}
            onChange={(event) => update.mutate({ enabled: event.target.checked })}
          />
          {t("agents.proactive.enabled")}
        </label>
      </div>

      {value && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <NumberSetting
            label={t("agents.proactive.dailyBudget")}
            value={value.dailyRunBudget}
            min={0}
            max={100}
            onChange={(dailyRunBudget) => update.mutate({ dailyRunBudget })}
          />
          <NumberSetting
            label={t("agents.proactive.maxToolCalls")}
            value={value.maxToolCalls}
            min={1}
            max={100}
            onChange={(maxToolCalls) => update.mutate({ maxToolCalls })}
          />
          <NumberSetting
            label={t("agents.proactive.maxRuntimeSeconds")}
            value={value.maxRuntimeSeconds}
            min={10}
            max={3600}
            onChange={(maxRuntimeSeconds) => update.mutate({ maxRuntimeSeconds })}
          />
          <NumberSetting
            label={t("agents.proactive.maxTotalTokens")}
            value={value.maxTotalTokens}
            min={1000}
            max={1000000}
            onChange={(maxTotalTokens) => update.mutate({ maxTotalTokens })}
          />
          <NumberSetting
            label={t("agents.proactive.cooldown")}
            value={value.cooldownHours}
            min={1}
            max={720}
            onChange={(cooldownHours) => update.mutate({ cooldownHours })}
          />
          <NumberSetting
            label={t("agents.proactive.idleDays")}
            value={value.idleFallbackDays}
            min={1}
            max={365}
            onChange={(idleFallbackDays) => update.mutate({ idleFallbackDays })}
          />
          <NumberSetting
            label={t("agents.proactive.quietStart")}
            value={value.quietStartHour}
            min={0}
            max={23}
            onChange={(quietStartHour) => update.mutate({ quietStartHour })}
          />
          <NumberSetting
            label={t("agents.proactive.quietEnd")}
            value={value.quietEndHour}
            min={0}
            max={23}
            onChange={(quietEndHour) => update.mutate({ quietEndHour })}
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t("agents.proactive.readOnly")}
      </div>

      {discovered.length > 0 && (
        <div className="mt-4 space-y-2">
          {discovered.map((candidate) => (
            <div key={candidate.id} className="rounded-md border border-[var(--border)] p-3">
              <p className="text-xs text-[var(--text)]">{candidate.reason}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={approve.isPending || ignore.isPending}
                  onClick={() => ignore.mutate(candidate.id)}
                  className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                >
                  {t("agents.proactive.ignore")}
                </button>
                <button
                  type="button"
                  disabled={approve.isPending || ignore.isPending}
                  onClick={() => approve.mutate(candidate.id)}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {t("agents.proactive.review")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  function commit(input: HTMLInputElement) {
    const next = Number(input.value);
    if (Number.isInteger(next) && next >= min && next <= max) {
      if (next !== value) onChange(next);
    } else {
      input.value = String(value);
    }
  }

  return (
    <label className="text-[11px] text-[var(--text-muted)]">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") event.currentTarget.value = String(value);
        }}
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)]"
      />
    </label>
  );
}
