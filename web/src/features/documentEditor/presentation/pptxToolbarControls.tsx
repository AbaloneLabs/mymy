import type { PptxLineArrow } from "../shared/models";

const PPTX_LINE_ARROW_OPTIONS: Array<{ value: PptxLineArrow; label: string }> = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Triangle" },
  { value: "stealth", label: "Stealth" },
  { value: "diamond", label: "Diamond" },
  { value: "oval", label: "Oval" },
];

export function LineArrowSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PptxLineArrow;
  onChange: (value: PptxLineArrow) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as PptxLineArrow)}
        className="h-6 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      >
        {PPTX_LINE_ARROW_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PptxTableFlagToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}
