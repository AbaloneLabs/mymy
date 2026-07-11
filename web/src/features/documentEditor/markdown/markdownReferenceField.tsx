import { useState } from "react";

interface MarkdownReferenceFieldProps {
  value: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  className: string;
  onCommit: (value: string) => void;
}

/**
 * Reference fields are transactional because a footnote rename can fan out to
 * multiple source spans. Keeping a local draft ensures Escape is a true
 * A -> A' -> A cancellation and prevents a confirmation prompt on every
 * keystroke.
 */
export function MarkdownReferenceField({
  value,
  ...props
}: MarkdownReferenceFieldProps) {
  return <MarkdownReferenceFieldDraft key={value} value={value} {...props} />;
}

function MarkdownReferenceFieldDraft({
  value,
  multiline = false,
  rows,
  disabled = false,
  className,
  onCommit,
}: MarkdownReferenceFieldProps) {
  const [draft, setDraft] = useState(value);

  function commit() {
    if (disabled || draft === value) return;
    onCommit(draft);
  }

  function cancel(element: HTMLInputElement | HTMLTextAreaElement) {
    setDraft(value);
    element.blur();
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={rows}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel(event.currentTarget);
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={className}
      />
    );
  }

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel(event.currentTarget);
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
