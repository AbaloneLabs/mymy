import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSecurityStatus } from "@/features/settings/api";
import { cn } from "@/lib/utils";

export function SecuritySection() {
  const { t } = useTranslation();
  const { data } = useSecurityStatus();

  const rows = [
    {
      label: t("settings.security.redaction"),
      enabled: data?.redactionEnabled ?? false,
    },
    {
      label: t("settings.security.filesystemGuard"),
      enabled: data?.filesystemGuardEnabled ?? false,
    },
    {
      label: t("settings.security.tlsValidation"),
      enabled: data?.tlsValidationEnabled ?? false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
          >
            <div className="flex items-center gap-2">
              {row.enabled ? (
                <ShieldCheck
                  className="h-4 w-4 text-[var(--status-success)]"
                  strokeWidth={1.5}
                />
              ) : (
                <ShieldAlert
                  className="h-4 w-4 text-[var(--status-error)]"
                  strokeWidth={1.5}
                />
              )}
              <span className="text-sm font-medium text-[var(--text)]">
                {row.label}
              </span>
            </div>
            <div
              className={cn(
                "mt-2 text-xs",
                row.enabled
                  ? "text-[var(--status-success)]"
                  : "text-[var(--status-error)]",
              )}
            >
              {row.enabled
                ? t("settings.security.enabled")
                : t("settings.security.disabled")}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="text-sm font-medium text-[var(--text)]">
          {t("settings.security.secretSources")}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(data?.secretSources ?? []).map((source) => (
            <span
              key={source.name}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                source.configured
                  ? "border-[var(--status-success)]/30 text-[var(--status-success)]"
                  : "border-[var(--border)] text-[var(--text-muted)]",
              )}
            >
              {source.configured && <Check className="h-3 w-3" strokeWidth={2} />}
              {source.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
