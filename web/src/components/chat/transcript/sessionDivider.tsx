export function SessionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
