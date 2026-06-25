import { useRef, useState } from "react";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/store/auth";
import { useVerifyPin } from "@/features/auth/api";
import { cn } from "@/lib/utils";


export default function PinScreen() {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const verifyPin = useVerifyPin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await verifyPin.mutateAsync(value);
      if (res.valid && res.authenticated) {
        setAuthenticated();
        navigate("/", { replace: true });
      } else {
        setError(true);
        setValue("");
        inputRef.current?.focus();
      }
    } catch {
      setError(true);
      setValue("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)]">
            <Lock className="h-6 w-6 text-white" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-semibold text-[var(--text)]">mymy</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t("pin.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={inputRef}
            type="password"
            inputMode="text"
            autoComplete="current-password"
            value={value}
            autoFocus
            disabled={verifyPin.isPending}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            placeholder={t("pin.placeholder")}
            className={cn(
              "w-full rounded-lg border bg-[var(--surface)] px-3.5 py-2.5 text-center text-base text-[var(--text)]",
              "outline-none transition-colors duration-150",
              "placeholder:text-[var(--text-muted)]",
              error
                ? "border-[var(--status-error)] focus:border-[var(--status-error)]"
                : "border-[var(--border)] focus:border-[var(--accent)]"
            )}
          />

          {error && (
            <p className="text-center text-xs text-[var(--status-error)]">
              {t("pin.error")}
            </p>
          )}

          <button
            type="submit"
            disabled={!value || verifyPin.isPending}
            className={cn(
              "w-full rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors duration-150",
              "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            {verifyPin.isPending ? t("common.loading") : t("pin.unlock")}
          </button>
        </form>
      </div>
    </div>
  );
}
