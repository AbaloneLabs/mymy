import { useState } from "react";
import {
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgents } from "@/features/agents/api";
import {
  previewUrl,
  useCreatePreviewEndpoint,
  useDeletePreviewEndpoint,
  useDriveProviders,
  useDriveSyncJobs,
  usePreviewEndpoints,
} from "@/features/drive/api";
import { cn } from "@/lib/utils";
import { StatusPill } from "./DriveStatus";

export function DriveSidePanel({
  selectedAgentProfile,
}: {
  selectedAgentProfile: string | null;
}) {
  const { t } = useTranslation();
  const providers = useDriveProviders();
  const syncJobs = useDriveSyncJobs();
  const previews = usePreviewEndpoints(selectedAgentProfile);
  const agents = useAgents();
  const createPreview = useCreatePreviewEndpoint();
  const deletePreview = useDeletePreviewEndpoint();
  const [previewAgent, setPreviewAgent] = useState(selectedAgentProfile ?? "");
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewTarget, setPreviewTarget] = useState("http://127.0.0.1:5173");

  function handleCreatePreview() {
    const agentProfile = previewAgent.trim() || selectedAgentProfile || "";
    if (!agentProfile || !previewLabel.trim() || !previewTarget.trim()) return;
    createPreview.mutate(
      {
        agentProfile,
        label: previewLabel.trim(),
        targetUrl: previewTarget.trim(),
        visibility: "session",
      },
      {
        onSuccess: () => setPreviewLabel(""),
      },
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-[var(--border)] p-4">
      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("drive.providers")}</h2>
        <div className="space-y-2">
          {(providers.data?.providers ?? []).map((provider) => (
            <div
              key={provider.provider}
              className="rounded-md border border-[var(--border)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{provider.provider}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-medium",
                    provider.configured
                      ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
                      : "bg-[var(--surface-muted)] text-[var(--text-faint)]",
                  )}
                >
                  {provider.configured
                    ? t("drive.configured")
                    : t("drive.notConfigured")}
                </span>
              </div>
              {(provider.bucket || provider.region || provider.endpoint) && (
                <p className="mt-2 break-all text-xs text-[var(--text-muted)]">
                  {[provider.bucket, provider.region, provider.endpoint]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("drive.syncJobs")}</h2>
          <button
            type="button"
            onClick={() => void syncJobs.refetch()}
            className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title={t("common.refresh")}
          >
            <RefreshCw className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
        <div className="space-y-2">
          {(syncJobs.data?.jobs ?? []).slice(0, 6).map((job) => (
            <div
              key={job.id}
              className="rounded-md border border-[var(--border)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--text)]">
                  {job.operation}
                </span>
                <StatusPill status={job.status} />
              </div>
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                {job.drivePath}
              </p>
              {job.error && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--status-error)]">
                  {job.error}
                </p>
              )}
            </div>
          ))}
          {!syncJobs.isLoading && (syncJobs.data?.jobs ?? []).length === 0 && (
            <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
              {t("drive.syncEmpty")}
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("drive.previews")}</h2>
        <div className="space-y-2">
          <select
            value={previewAgent || selectedAgentProfile || ""}
            onChange={(event) => setPreviewAgent(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          >
            <option value="">{t("drive.selectAgent")}</option>
            {(agents.data?.agents ?? []).map((agent) => (
              <option key={agent.profile} value={agent.profile}>
                {agent.name}
              </option>
            ))}
          </select>
          <input
            value={previewLabel}
            onChange={(event) => setPreviewLabel(event.target.value)}
            placeholder={t("drive.previewLabel")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          />
          <input
            value={previewTarget}
            onChange={(event) => setPreviewTarget(event.target.value)}
            placeholder="http://127.0.0.1:5173"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={handleCreatePreview}
            disabled={
              !(previewAgent || selectedAgentProfile) ||
              !previewLabel.trim() ||
              !previewTarget.trim() ||
              createPreview.isPending
            }
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            {t("drive.addPreview")}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {(previews.data?.previews ?? []).map((preview) => (
            <div
              key={preview.id}
              className="rounded-md border border-[var(--border)] p-3"
            >
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl(preview.token)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--accent)] hover:underline"
                >
                  {preview.label}
                </a>
                <ExternalLink
                  className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]"
                  strokeWidth={1.5}
                />
                <button
                  type="button"
                  onClick={() => deletePreview.mutate(preview.id)}
                  className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
                  title={t("common.delete")}
                >
                  <Trash2 className="mx-auto h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                {preview.targetUrl}
              </p>
            </div>
          ))}
          {!previews.isLoading && (previews.data?.previews ?? []).length === 0 && (
            <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
              {t("drive.noPreviews")}
            </p>
          )}
        </div>
      </section>
    </aside>
  );
}
