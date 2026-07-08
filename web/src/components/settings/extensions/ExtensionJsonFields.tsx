export function JsonEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-xs text-[var(--text-muted)]">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-36 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

export function ReadonlyJson({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-[var(--text-muted)]">{label}</div>
      <pre className="max-h-40 overflow-auto rounded-md bg-[var(--bg)] p-2 font-mono text-xs text-[var(--text-muted)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
