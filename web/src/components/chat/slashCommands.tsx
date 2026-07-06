import { Boxes, Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SlashOption } from "./slashCommandUtils";

export function SlashCommandMenu({
  options,
  onSelect,
}: {
  options: SlashOption[];
  onSelect: (option: SlashOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
      {options.map((option) => {
        const Icon = option.type === "bundle" ? Boxes : Puzzle;
        return (
          <button
            key={`${option.type}:${option.name}`}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option)}
            className="flex w-full items-start gap-2 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)]"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-[var(--text)]">
                  /{option.name}
                </span>
                <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {option.type === "bundle" ? t("chat.slashBundle") : t("chat.slashSkill")}
                </span>
              </span>
              {option.description && (
                <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SlashCommandPreview({ option }: { option: SlashOption }) {
  const { t } = useTranslation();
  if (option.type !== "bundle" || option.skills.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span>{t("chat.slashPreview")}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {option.skills.map((skill) => (
          <span
            key={skill}
            className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}
