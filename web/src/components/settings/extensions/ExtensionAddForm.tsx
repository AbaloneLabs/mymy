import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ExtensionKind,
  useCreateExtension,
} from "@/features/extensions/api";
import { TextField } from "../shared/TextField";
import { JsonEditor } from "./ExtensionJsonFields";
import {
  DEFAULT_EXTENSION_PARAMETERS,
  extensionKindLabel,
  parseExtensionJson,
} from "./extensionSettingsUtils";

export function ExtensionAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMutation = useCreateExtension();
  const [kind, setKind] = useState<ExtensionKind>("webhook");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parameters, setParameters] = useState(DEFAULT_EXTENSION_PARAMETERS);
  const [settings, setSettings] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const parsedParameters = parseExtensionJson(parameters, () =>
      setError(t("settings.extensions.invalidJson")),
    );
    const parsedSettings = parseExtensionJson(settings, () =>
      setError(t("settings.extensions.invalidJson")),
    );
    if (parsedParameters === undefined || parsedSettings === undefined) return;
    createMutation.mutate(
      {
        kind,
        name,
        description,
        enabled: true,
        parameters: parsedParameters,
        settings: parsedSettings,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("settings.extensions.kind")}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ExtensionKind)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="webhook">{extensionKindLabel("webhook")}</option>
            <option value="script">{extensionKindLabel("script")}</option>
            <option value="mcp_server">{extensionKindLabel("mcp_server")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("settings.extensions.name")}
          <TextField value={name} onChange={setName} placeholder="tool_name" />
        </label>
      </div>
      <label className="mt-3 block space-y-1 text-xs text-[var(--text-muted)]">
        {t("settings.extensions.descriptionLabel")}
        <TextField value={description} onChange={setDescription} />
      </label>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <JsonEditor
          label={t("settings.extensions.parameters")}
          value={parameters}
          onChange={setParameters}
        />
        <JsonEditor
          label={t("settings.extensions.settings")}
          value={settings}
          onChange={setSettings}
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-[var(--danger)]">{error}</span>}
        {createMutation.isError && (
          <span className="mr-auto text-xs text-[var(--danger)]">
            {t("settings.extensions.saveFailed")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          {t("settings.extensions.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={createMutation.isPending || !name.trim()}
          className="rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("settings.extensions.save")}
        </button>
      </div>
    </div>
  );
}
