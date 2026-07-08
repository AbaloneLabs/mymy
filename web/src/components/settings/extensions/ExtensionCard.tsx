import { useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AgentExtension,
  useDeleteExtension,
  useTestExtension,
  useUpdateExtension,
} from "@/features/extensions/api";
import { Toggle } from "../shared/Toggle";
import { ReadonlyJson } from "./ExtensionJsonFields";
import { ExtensionStatusBadge } from "./ExtensionStatusBadge";
import {
  extensionKindLabel,
  parseExtensionJson,
} from "./extensionSettingsUtils";

export function ExtensionCard({ extension }: { extension: AgentExtension }) {
  const { t } = useTranslation();
  const updateMutation = useUpdateExtension();
  const deleteMutation = useDeleteExtension();
  const testMutation = useTestExtension();
  const [args, setArgs] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function test() {
    setError(null);
    const parsed = parseExtensionJson(args, () =>
      setError(t("settings.extensions.invalidJson")),
    );
    if (parsed === undefined) return;
    testMutation.mutate({ id: extension.id, args: parsed });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-[var(--text)]">
              {extension.name}
            </h3>
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {extensionKindLabel(extension.kind)}
            </span>
            <ExtensionStatusBadge extension={extension} />
          </div>
          {extension.description && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {extension.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Toggle
            checked={extension.enabled}
            onChange={(enabled) =>
              updateMutation.mutate({ id: extension.id, body: { enabled } })
            }
            ariaLabel={t("settings.extensions.enabled")}
            disabled={updateMutation.isPending}
          />
          <button
            type="button"
            onClick={() => deleteMutation.mutate(extension.id)}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
            aria-label={t("settings.extensions.delete")}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ReadonlyJson
          label={t("settings.extensions.parameters")}
          value={extension.parameters}
        />
        <ReadonlyJson
          label={t("settings.extensions.settings")}
          value={extension.settings}
        />
      </div>

      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        <label className="block text-xs text-[var(--text-muted)]">
          {t("settings.extensions.testArgs")}
        </label>
        <textarea
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={test}
            disabled={testMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {t("settings.extensions.test")}
          </button>
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
        </div>
        {testMutation.data && (
          <pre className="max-h-52 overflow-auto rounded-md bg-[var(--bg)] p-2 font-mono text-xs text-[var(--text-muted)]">
            {JSON.stringify(testMutation.data.output, null, 2)}
          </pre>
        )}
        {testMutation.isError && (
          <p className="text-xs text-[var(--danger)]">
            {t("settings.extensions.testFailed")}
          </p>
        )}
      </div>
    </div>
  );
}
