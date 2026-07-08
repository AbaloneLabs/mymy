import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChangePin } from "@/features/auth/api";
import { TextField } from "../shared/TextField";
import { cn } from "@/lib/utils";


export function PinChangeForm() {
  const { t } = useTranslation();
  const changePin = useChangePin();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "error" | "success">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("idle");
    setMessage("");

    if (next.length < 4) {
      setStatus("error");
      setMessage(t("pinForm.tooShort"));
      return;
    }
    if (next !== confirm) {
      setStatus("error");
      setMessage(t("pinForm.mismatch"));
      return;
    }

    try {
      await changePin.mutateAsync({ currentPin: current, newPin: next });
      setStatus("success");
      setMessage(t("pinForm.success"));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setStatus("error");
      setMessage(t("pinForm.wrongCurrent"));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TextField
          type="password"
          value={current}
          onChange={setCurrent}
          placeholder={t("pinForm.currentPlaceholder")}
          full
        />
        <TextField
          type="password"
          value={next}
          onChange={setNext}
          placeholder={t("pinForm.newPlaceholder")}
          full
        />
        <TextField
          type="password"
          value={confirm}
          onChange={setConfirm}
          placeholder={t("pinForm.confirmPlaceholder")}
          full
        />
      </div>

      {message && (
        <p
          className={cn(
            "text-xs",
            status === "error" ? "text-[var(--status-error)]" : "text-[var(--status-active)]"
          )}
        >
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={!current || !next || !confirm || changePin.isPending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150",
          "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
        {changePin.isPending ? t("common.loading") : t("pinForm.submit")}
      </button>
    </form>
  );
}
