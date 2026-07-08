import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ApiFormat, LlmProviderPreset } from "@/types/settings";
import { useCreateLlmProvider } from "@/features/llm-providers/api";
import { TextField } from "../shared/TextField";
import { ModelSelect } from "../shared/ModelSelect";
import { cn } from "@/lib/utils";

/** Preset metadata: label, default base_url, default api_format. */
const PRESETS: Record<
  LlmProviderPreset,
  { label: string; baseUrl: string; format: Exclude<ApiFormat, "auto"> }
> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    format: "openai",
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    format: "anthropic",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    format: "openai",
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    format: "openai",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    format: "openai",
  },
  together: {
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    format: "openai",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    format: "openai",
  },
  custom: { label: "Custom…", baseUrl: "", format: "openai" },
};

export function LlmProviderAddForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMutation = useCreateLlmProvider();
  const [preset, setPreset] = useState<LlmProviderPreset>("openai");
  const [label, setLabel] = useState("");
  const [apiFormat, setApiFormat] = useState<ApiFormat>("openai");
  const [baseUrl, setBaseUrl] = useState(PRESETS.openai.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [maxTokens, setMaxTokens] = useState("16384");

  const handlePresetChange = (p: LlmProviderPreset) => {
    setPreset(p);
    const meta = PRESETS[p];
    setBaseUrl(meta.baseUrl);
    setApiFormat(meta.format);
    if (!label) {
      setLabel(meta.label === "Custom…" ? "" : meta.label);
    }
  };

  const handleSave = () => {
    const meta = PRESETS[preset];
    const trimmedLabel =
      label.trim() ||
      (meta.label !== "Custom…" ? meta.label : t("settings.models.newProvider"));
    createMutation.mutate({
      label: trimmedLabel,
      api_format: apiFormat,
      base_url: baseUrl,
      api_key: apiKey,
      model: model || "gpt-4o-mini",
      max_tokens: Number(maxTokens) || 16384,
      preset: preset === "custom" ? undefined : preset,
    });
    onClose();
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--bg)] p-4">
      {/* Preset dropdown */}
      <LabeledRow label={t("settings.models.preset")}>
        <select
          value={preset}
          onChange={(e) =>
            handlePresetChange(e.target.value as LlmProviderPreset)
          }
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none transition-colors duration-150 focus:border-[var(--accent)]"
        >
          {(Object.keys(PRESETS) as LlmProviderPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESETS[p].label}
            </option>
          ))}
        </select>
      </LabeledRow>

      <LabeledRow label={t("common.name")}>
        <TextField
          value={label}
          onChange={setLabel}
          placeholder={t("settings.models.namePlaceholder")}
        />
      </LabeledRow>

      {/* API Format selector */}
      <LabeledRow label={t("settings.models.apiFormat")}>
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {(["openai", "anthropic", "auto"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setApiFormat(f)}
              className={cn(
                "px-3 py-1 text-xs uppercase transition-colors duration-150",
                apiFormat === f
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </LabeledRow>

      <LabeledRow label={t("settings.models.baseUrl")}>
        <TextField
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder="https://api.openai.com/v1"
        />
      </LabeledRow>

      <LabeledRow label={t("settings.models.apiKey")}>
        <TextField
          value={apiKey}
          onChange={setApiKey}
          type="password"
          placeholder="sk-..."
        />
      </LabeledRow>

      <LabeledRow label={t("settings.models.model")}>
        <ModelSelect
          value={model}
          onChange={setModel}
          baseUrl={baseUrl}
          apiKey={apiKey}
          apiFormat={apiFormat}
        />
      </LabeledRow>

      <LabeledRow label={t("settings.models.maxTokens")} full={false}>
        <TextField
          value={maxTokens}
          onChange={setMaxTokens}
          placeholder="16384"
          full={false}
          type="number"
        />
      </LabeledRow>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!baseUrl || !apiKey}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

function LabeledRow({
  label,
  children,
  full = true,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
        {label}
      </span>
      <div className={full ? "flex-1" : ""}>{children}</div>
    </div>
  );
}
