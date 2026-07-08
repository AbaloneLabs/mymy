export function PercentInput({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={Math.round(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-14 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}
