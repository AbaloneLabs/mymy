import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AgentExtension,
  type ExtensionKind,
  useCreateExtension,
  useDeleteExtension,
  useExtensions,
  useTestExtension,
  useUpdateExtension,
} from "@/features/extensions/api";
import { useMcpServers, type McpServerStatus } from "@/features/mcp/api";
import { TextField } from "./TextField";
import { Toggle } from "./Toggle";

const DEFAULT_PARAMETERS = '{\n  "type": "object",\n  "properties": {}\n}';

export function ExtensionsSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useExtensions();
  const extensions = data?.extensions ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.extensions.add")}
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}

      {!isLoading && extensions.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
          {t("settings.extensions.empty")}
        </div>
      )}

      <div className="space-y-2">
        {extensions.map((extension) => (
          <ExtensionCard key={extension.id} extension={extension} />
        ))}
      </div>

      {adding && <ExtensionAddForm onClose={() => setAdding(false)} />}

      <McpServersPanel />
    </div>
  );
}

function McpServersPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMcpServers();
  const servers = data?.servers ?? [];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-[var(--text)]">
          {t("settings.extensions.mcpServers")}
        </h3>
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}
      {!isLoading && isError && (
        <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 text-xs text-[var(--status-error)]">
          {t("settings.extensions.mcpLoadError")}
        </div>
      )}
      {!isLoading && !isError && servers.length === 0 && (
        <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.extensions.mcpEmpty")}
        </div>
      )}
      {!isLoading && !isError && servers.length > 0 && (
        <div className="space-y-2">
          {servers.map((server) => (
            <McpServerCard key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpServerCard({ server }: { server: McpServerStatus }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--text)]">
              {server.name}
            </span>
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {server.transport}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {server.source} · {server.toolCount} {t("settings.extensions.mcpTools")}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            server.healthy
              ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
              : "bg-[var(--status-error)]/10 text-[var(--status-error)]"
          }`}
        >
          {server.healthy ? (
            <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
          )}
          {server.healthy
            ? t("settings.extensions.mcpHealthy")
            : t("settings.extensions.mcpUnhealthy")}
        </span>
      </div>
      {server.error && (
        <p className="mt-2 text-xs text-[var(--status-error)]">{server.error}</p>
      )}
      {server.tools.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {server.tools.map((tool) => (
            <div
              key={tool.prefixedName}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
            >
              <div className="font-mono text-xs text-[var(--text)]">
                {tool.prefixedName}
              </div>
              {tool.description && (
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {tool.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtensionCard({ extension }: { extension: AgentExtension }) {
  const { t } = useTranslation();
  const updateMutation = useUpdateExtension();
  const deleteMutation = useDeleteExtension();
  const testMutation = useTestExtension();
  const [args, setArgs] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function test() {
    setError(null);
    const parsed = parseJson(args, () => setError(t("settings.extensions.invalidJson")));
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
              {kindLabel(extension.kind)}
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
        <ReadonlyJson label={t("settings.extensions.parameters")} value={extension.parameters} />
        <ReadonlyJson label={t("settings.extensions.settings")} value={extension.settings} />
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

function ExtensionStatusBadge({ extension }: { extension: AgentExtension }) {
  const { t } = useTranslation();
  const healthy = extension.status.state === "callable";
  const configured = extension.status.state === "configured";
  const disabled = extension.status.state === "disabled";
  const Icon = healthy || configured ? CheckCircle2 : AlertTriangle;
  const className = healthy
    ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
    : configured
      ? "bg-[var(--surface-hover)] text-[var(--text-muted)]"
      : disabled
        ? "bg-[var(--surface-hover)] text-[var(--text-faint)]"
        : "bg-[var(--status-error)]/10 text-[var(--status-error)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${className}`}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {t(`settings.extensions.status.${extension.status.state}`)}
    </span>
  );
}

function ExtensionAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMutation = useCreateExtension();
  const [kind, setKind] = useState<ExtensionKind>("webhook");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [settings, setSettings] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const parsedParameters = parseJson(parameters, () =>
      setError(t("settings.extensions.invalidJson")),
    );
    const parsedSettings = parseJson(settings, () =>
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
            <option value="webhook">{kindLabel("webhook")}</option>
            <option value="script">{kindLabel("script")}</option>
            <option value="mcp_server">{kindLabel("mcp_server")}</option>
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

function JsonEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-xs text-[var(--text-muted)]">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-36 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function ReadonlyJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs text-[var(--text-muted)]">{label}</div>
      <pre className="max-h-40 overflow-auto rounded-md bg-[var(--bg)] p-2 font-mono text-xs text-[var(--text-muted)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function parseJson(value: string, onError: () => void): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    onError();
    return undefined;
  }
}

function kindLabel(kind: ExtensionKind) {
  if (kind === "mcp_server") return "MCP";
  return kind.toUpperCase();
}
