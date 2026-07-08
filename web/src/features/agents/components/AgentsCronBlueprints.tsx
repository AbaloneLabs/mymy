import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useInstantiateCronBlueprint,
  type CronBlueprint,
  type CronBlueprintField,
} from "@/features/agent-ops/api";

export function CronBlueprintPanel({ blueprints }: { blueprints: CronBlueprint[] }) {
  const { t } = useTranslation();
  if (blueprints.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 text-sm font-medium text-[var(--text)]">
        {t("agents.cron.blueprints")}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {blueprints.slice(0, 6).map((blueprint) => (
          <CronBlueprintCard key={blueprint.key} blueprint={blueprint} />
        ))}
      </div>
    </div>
  );
}

function CronBlueprintCard({ blueprint }: { blueprint: CronBlueprint }) {
  const { t } = useTranslation();
  const instantiateMutation = useInstantiateCronBlueprint();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      blueprintFields(blueprint).map((field) => [
        field.name,
        field.default ?? (field.type === "boolean" ? false : ""),
      ]),
    ),
  );

  function instantiate() {
    instantiateMutation.mutate(
      {
        key: blueprint.key,
        values,
        title: blueprint.title,
        schedule: blueprint.defaultSchedule,
        enabled: true,
      },
      { onSuccess: () => setExpanded(false) },
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {blueprint.title}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
            {blueprint.description}
          </p>
          <code className="mt-2 inline-block rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
            {blueprint.defaultSchedule}
          </code>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {expanded ? t("agents.cron.cancel") : t("agents.cron.use")}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {blueprintFields(blueprint).map((field) => (
            <BlueprintField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(value) =>
                setValues((current) => ({ ...current, [field.name]: value }))
              }
            />
          ))}
          <div className="flex items-center justify-end gap-2">
            {instantiateMutation.isError && (
              <span className="mr-auto text-xs text-[var(--danger)]">
                {t("agents.cron.saveFailed")}
              </span>
            )}
            <button
              type="button"
              onClick={instantiate}
              disabled={instantiateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {instantiateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {t("agents.cron.createFromBlueprint")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BlueprintField({
  field,
  value,
  onChange,
}: {
  field: CronBlueprintField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        {field.name}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  return (
    <label className="block space-y-1 text-xs text-[var(--text-muted)]">
      {field.name}
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function blueprintFields(blueprint: CronBlueprint) {
  return blueprint.formSchema.fields ?? [];
}
