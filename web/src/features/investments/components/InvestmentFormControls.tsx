import type { FormEvent, ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { inputClassName } from "./InvestmentFormOptions";

export function SmallForm({
  title,
  children,
  pending,
  disabled,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  pending: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && !pending) onSubmit();
  }
  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Plus className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
      <button
        type="submit"
        disabled={disabled || pending}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        )}
        추가
      </button>
    </form>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
}
