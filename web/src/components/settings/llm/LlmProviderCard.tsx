import { useState } from "react";
import { Check, Pencil, Star, Trash2, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LlmProvider, ProviderRateLimitStatus } from "@/types/settings";
import {
  useUpdateLlmProvider,
  useDeleteLlmProvider,
  useSetDefaultLlmProvider,
  useTestLlmProvider,
} from "@/features/llm-providers/api";
import { Toggle } from "../shared/Toggle";
import { TextField } from "../shared/TextField";
import { cn } from "@/lib/utils";
import {
  LlmProviderDeleteConfirm,
  LlmProviderIconButton,
  LlmProviderTestActions,
} from "./LlmProviderCardActions";
import {
  EditFields,
  ViewFields,
  type DraftState,
} from "./LlmProviderCardFields";

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
  const [draft, setDraft] = useState<DraftState>({
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
              <LlmProviderIconButton onClick={saveEdit} label={t("common.save")}>
                <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
              </LlmProviderIconButton>
              <LlmProviderIconButton onClick={cancelEdit} label={t("common.cancel")}>
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </LlmProviderIconButton>
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
              <LlmProviderIconButton onClick={startEdit} label={t("common.edit")}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              </LlmProviderIconButton>
              <LlmProviderIconButton
                onClick={() => setConfirmDelete(true)}
                label={t("common.delete")}
                danger
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </LlmProviderIconButton>
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

      {!editing && (
        <LlmProviderTestActions
          provider={provider}
          isTesting={isTesting}
          testResult={testResult}
          onTest={handleTest}
          onSetDefault={() => setDefaultMutation.mutate(provider.id)}
        />
      )}

      {confirmDelete && (
        <LlmProviderDeleteConfirm
          providerName={provider.label}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleRemove}
        />
      )}
    </div>
  );
}
