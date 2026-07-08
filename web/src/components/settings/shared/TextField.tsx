import { cn } from "@/lib/utils";

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;

  full?: boolean;
  type?: "text" | "password" | "number";
}


export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  full = true,
  type = "text",
}: TextFieldProps) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]",
        "outline-none transition-colors duration-150",
        "placeholder:text-[var(--text-faint)]",
        "focus:border-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        full ? "w-full" : "w-40",
        className
      )}
    />
  );
}
