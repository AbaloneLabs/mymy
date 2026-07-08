import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  ApiFormat,
  LlmProvider,
  ProviderRateLimitStatus,
} from "@/types/settings";
import { ModelSelect } from "../shared/ModelSelect";
import { TextField } from "../shared/TextField";

export interface DraftState {
  label: string;
  api_format: ApiFormat;
  base_url: string;
  model: string;
  max_tokens: string;
  api_key: string;
}

export function ViewFields({
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

export function EditFields({
  draft,
  setDraft,
}: {
  draft: DraftState;
  setDraft: (d: DraftState) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
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

      <LabeledInput
        label={t("settings.models.apiKey")}
        value={draft.api_key}
        onChange={(api_key) => setDraft({ ...draft, api_key })}
        placeholder={t("settings.models.apiKeyKeep")}
        type="password"
      />

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
