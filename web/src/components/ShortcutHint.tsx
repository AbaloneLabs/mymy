/**
 * ShortcutHint — renders a key sequence as styled <kbd> elements.
 *
 * A chord (e.g. ["mod", "k"]) shows keys joined with "+".
 * A sequence (e.g. ["g", "h"]) shows keys joined with a space.
 *
 * The `mod` token is resolved to the platform-appropriate symbol via
 * `formatKey` from lib/platform.
 */
import { Fragment } from "react";
import { formatKey, isSequence } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface ShortcutHintProps {
  /** Key tokens, e.g. ["mod", "k"] or ["g", "h"]. */
  keys: string[];
  /** Extra classes for each <kbd> element. */
  className?: string;
}

export function ShortcutHint({ keys, className }: ShortcutHintProps) {
  if (!keys.length) return null;
  const sequence = isSequence(keys);
  const separator = sequence ? " " : "+";

  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <Fragment key={`${k}-${i}`}>
          <kbd
            className={cn(
              "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-hover)] px-1 font-mono text-[10px] font-medium text-[var(--text-muted)]",
              className
            )}
          >
            {formatKey(k)}
          </kbd>
          {i < keys.length - 1 && (
            <span className="text-[10px] text-[var(--text-faint)]">
              {separator}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
