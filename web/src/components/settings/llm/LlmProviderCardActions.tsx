import type { ReactNode } from "react";
import { AlertCircle, Check, Loader2, Star, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/types/settings";

interface TestConnectionResult {
  ok: boolean;
  error?: string;
  latency_ms?: number;
}

export function LlmProviderTestActions({
  provider,
  isTesting,
  testResult,
  onTest,
  onSetDefault,
}: {
  provider: LlmProvider;
  isTesting: boolean;
  testResult?: TestConnectionResult;
  onTest: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
      <div className="text-xs">
        {isTesting && (
          <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
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

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onTest}
          disabled={isTesting}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Zap className="h-3 w-3" strokeWidth={1.5} />
          {t("settings.models.test")}
        </button>
        {!provider.is_default && (
          <button
            type="button"
            onClick={onSetDefault}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Star className="h-3 w-3" strokeWidth={1.5} />
            {t("settings.models.setDefault")}
          </button>
        )}
      </div>
    </div>
  );
}

export function LlmProviderDeleteConfirm({
  providerName,
  onCancel,
  onConfirm,
}: {
  providerName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-2">
      <span className="text-xs text-[var(--text-muted)]">
        {t("settings.models.deleteConfirmTitle", { name: providerName })}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)]"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-[var(--status-error)] px-2 py-1 text-xs text-white transition-colors duration-150 hover:opacity-90"
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

export function LlmProviderIconButton({
  children,
  onClick,
  label,
  danger,
}: {
  children: ReactNode;
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
