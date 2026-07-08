import { cn } from "@/lib/utils";

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            value === option
              ? "bg-[var(--surface-hover)] text-[var(--text)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
