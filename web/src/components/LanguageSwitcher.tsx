
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe } from "lucide-react";
import { SUPPORTED_LANGUAGES, syncHtmlLang } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useUpdateLanguage } from "@/features/settings/api";
import { cn } from "@/lib/utils";

export default function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { i18n } = useTranslation();
  const { settings, setLanguage } = useSettingsStore();
  const updateLanguage = useUpdateLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (settings.language && settings.language !== i18n.language) {
      void i18n.changeLanguage(settings.language);
      syncHtmlLang(settings.language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === settings.language) ??
    SUPPORTED_LANGUAGES[0];

  function handleSelect(code: string) {
    setLanguage(code as typeof settings.language);
    void i18n.changeLanguage(code);
    syncHtmlLang(code);
    // Persist to backend (best-effort).
    updateLanguage.mutate(code as typeof settings.language);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={current.label}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
          "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          collapsed && "justify-center px-0",
          open && "bg-[var(--surface-hover)] text-[var(--text)]"
        )}
      >
        <Globe size={16} strokeWidth={1.75} />
        <span className={cn("flex-1 text-left", collapsed && "hidden")}>{current.label}</span>
        <span className={cn("text-[10px] font-semibold text-[var(--text-faint)]", collapsed && "hidden")}>
          {current.short}
        </span>
      </button>

      {open && (
        <div
          className={cn(
            "absolute bottom-full left-0 right-0 z-50 mb-1.5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl",
            "min-w-[160px]"
          )}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => handleSelect(lang.code)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-[13px] transition-colors",
                "hover:bg-[var(--surface-hover)]",
                lang.code === settings.language
                  ? "text-[var(--text)]"
                  : "text-[var(--text-muted)]"
              )}
            >
              <span>{lang.label}</span>
              {lang.code === settings.language && (
                <Check size={14} className="text-[var(--accent)]" strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
