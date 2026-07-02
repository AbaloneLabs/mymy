import { useState } from "react";
import {
  Pencil,
  Trash2,
  Check,
  X,
  Star,
  Zap,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  ApiFormat,
  LlmProvider,
  ProviderRateLimitStatus,
} from "@/types/settings";
import {
  useUpdateLlmProvider,
  useDeleteLlmProvider,
  useSetDefaultLlmProvider,
  useTestLlmProvider,
} from "@/features/llm-providers/api";
import { Toggle } from "./Toggle";
import { TextField } from "./TextField";
import { ModelSelect } from "./ModelSelect";
import { cn } from "@/lib/utils";

interface LlmProviderCardProps {
  provider: LlmProvider;
  rateLimitStatus?: ProviderRateLimitStatus;
}

export function LlmProviderCard({
  provider,
  rateLimitStatus,
}: LlmProviderCardProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateLlmProvider();
  const deleteMutation = useDeleteLlmProvider();
  const setDefaultMutation = useSetDefaultLlmProvider();
  const testMutation = useTestLlmProvider();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState({
    label: provider.label,
    api_format: provider.api_format,
    base_url: provider.base_url,
    model: provider.model,
    max_tokens: String(provider.max_tokens),
    api_key: "", // empty = keep existing
  });

  const startEdit = () => {
    setDraft({
      label: provider.label,
      api_format: provider.api_format,
      base_url: provider.base_url,
      model: provider.model,
      max_tokens: String(provider.max_tokens),
      api_key: "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    updateMutation.mutate({
      id: provider.id,
      body: {
        label: draft.label,
        api_format: draft.api_format,
        base_url: draft.base_url,
        model: draft.model,
        max_tokens: Number(draft.max_tokens) || 16384,
        ...(draft.api_key ? { api_key: draft.api_key } : {}),
      },
    });
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleRemove = () => {
    deleteMutation.mutate(provider.id);
  };

  const handleTest = () => {
    testMutation.mutate(provider.id);
  };

  const testResult = testMutation.data;
  const isTesting = testMutation.isPending && testMutation.variables === provider.id;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)]",
              provider.enabled
                ? "bg-[var(--surface-active)]"
                : "bg-[var(--surface-active)] opacity-40",
            )}
          >
            <Zap className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            {editing ? (
              <TextField
                value={draft.label}
                onChange={(label) => setDraft({ ...draft, label })}
                placeholder={t("settings.models.namePlaceholder")}
                full={false}
                className="w-48"
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text)]">
                  {provider.label}
                </span>
                {provider.is_default && (
                  <Star
                    className="h-3.5 w-3.5 fill-[var(--accent)] text-[var(--accent)]"
                    strokeWidth={1.5}
                  />
                )}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="font-mono">{provider.model}</span>
              <span>·</span>
              <span className="uppercase">{provider.api_format}</span>
              {!provider.enabled && (
                <>
                  <span>·</span>
                  <span>{t("common.disabled")}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <IconBtn onClick={saveEdit} label={t("common.save")}>
                <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconBtn>
              <IconBtn onClick={cancelEdit} label={t("common.cancel")}>
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconBtn>
            </>
          ) : (
            <>
              <Toggle
                checked={provider.enabled}
                onChange={(enabled) =>
                  updateMutation.mutate({
                    id: provider.id,
                    body: { enabled },
                  })
                }
                ariaLabel={t("status.enable", { label: provider.label })}
              />
              <IconBtn onClick={startEdit} label={t("common.edit")}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              </IconBtn>
              <IconBtn
                onClick={() => setConfirmDelete(true)}
                label={t("common.delete")}
                danger
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </IconBtn>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        {editing ? (
          <EditFields draft={draft} setDraft={setDraft} />
        ) : (
          <ViewFields provider={provider} rateLimitStatus={rateLimitStatus} />
        )}
      </div>

      {/* Test result + actions */}
      {!editing && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          {/* Test status */}
          <div className="text-xs">
            {isTesting && (
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Loader2
                  className="h-3 w-3 animate-spin"
                  strokeWidth={1.5}
                />
                {t("settings.models.testing")}
              </span>
            )}
            {!isTesting && testResult?.ok && (
              <span className="flex items-center gap-1.5 text-[var(--status-success)]">
                <Check className="h-3 w-3" strokeWidth={2} />
                {t("settings.models.testOk", { ms: testResult.latency_ms })}
              </span>
            )}
            {!isTesting && testResult && !testResult.ok && (
              <span className="flex items-center gap-1.5 text-[var(--status-error)]">
                <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
                {t("settings.models.testError", {
                  message: testResult.error ?? "Error",
                })}
              </span>
            )}
            {!isTesting && !testResult && (
              <span className="text-[var(--text-faint)]">
                {t("settings.models.untested")}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Zap className="h-3 w-3" strokeWidth={1.5} />
              {t("settings.models.test")}
            </button>
            {!provider.is_default && (
              <button
                type="button"
                onClick={() => setDefaultMutation.mutate(provider.id)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <Star className="h-3 w-3" strokeWidth={1.5} />
                {t("settings.models.setDefault")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-2">
          <span className="text-xs text-[var(--text-muted)]">
            {t("settings.models.deleteConfirmTitle", { name: provider.label })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-md bg-[var(--status-error)] px-2 py-1 text-xs text-white transition-colors duration-150 hover:opacity-90"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewFields({
  provider,
  rateLimitStatus,
}: {
  provider: LlmProvider;
  rateLimitStatus?: ProviderRateLimitStatus;
}) {
  const { t } = useTranslation();
  const credentials = rateLimitStatus?.credentials ?? [];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Field
          label={t("settings.models.format")}
          value={provider.api_format.toUpperCase()}
        />
        <Field label={t("settings.models.baseUrl")} value={provider.base_url} />
        <Field label={t("settings.models.apiKey")} value={provider.api_key_hint} />
        <Field
          label={t("settings.models.maxTokens")}
          value={String(provider.max_tokens)}
        />
      </dl>
      {credentials.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {credentials.map((credential) => (
            <span
              key={credential.credentialId ?? "primary"}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                credential.status === "ok"
                  ? "border-[var(--status-success)]/30 text-[var(--status-success)]"
                  : credential.status === "dead"
                    ? "border-[var(--status-error)]/30 text-[var(--status-error)]"
                    : "border-[var(--status-warning)]/30 text-[var(--status-warning)]",
              )}
            >
              {credential.label}
              <span className="text-[var(--text-faint)]">
                {credential.status === "exhausted" &&
                credential.resetAfterSecs !== undefined
                  ? t("settings.models.cooldown", {
                      seconds: credential.resetAfterSecs,
                    })
                  : t(`settings.models.credentialStatus.${credential.status}`, {
                      defaultValue: credential.status,
                    })}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface DraftState {
  label: string;
  api_format: ApiFormat;
  base_url: string;
  model: string;
  max_tokens: string;
  api_key: string;
}

function EditFields({
  draft,
  setDraft,
}: {
  draft: DraftState;
  setDraft: (d: DraftState) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {/* API Format */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
          {t("settings.models.apiFormat")}
        </span>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["openai", "anthropic", "auto"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setDraft({ ...draft, api_format: f })}
              className={cn(
                "px-3 py-1 text-xs uppercase transition-colors duration-150",
                draft.api_format === f
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <LabeledInput
        label={t("settings.models.baseUrl")}
        value={draft.base_url}
        onChange={(base_url) => setDraft({ ...draft, base_url })}
      />

      {/* API Key — click to change */}
      <LabeledInput
        label={t("settings.models.apiKey")}
        value={draft.api_key}
        onChange={(api_key) => setDraft({ ...draft, api_key })}
        placeholder={t("settings.models.apiKeyKeep")}
        type="password"
      />

      {/* Model select */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
          {t("settings.models.model")}
        </span>
        <div className="flex-1">
          <ModelSelect
            value={draft.model}
            onChange={(model) => setDraft({ ...draft, model })}
            baseUrl={draft.base_url}
            apiKey={draft.api_key}
            apiFormat={draft.api_format}
          />
        </div>
      </div>

      <LabeledInput
        label={t("settings.models.maxTokens")}
        value={draft.max_tokens}
        onChange={(max_tokens) => setDraft({ ...draft, max_tokens })}
        full={false}
        type="number"
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[var(--text-muted)]">
        {value}
      </dd>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  full = true,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
  type?: "text" | "password" | "number";
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
        {label}
      </span>
      <TextField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        full={full}
        type={type}
      />
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150",
        danger
          ? "text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      {children}
    </button>
  );
}
