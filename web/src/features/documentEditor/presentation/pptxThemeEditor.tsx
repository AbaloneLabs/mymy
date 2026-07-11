import { useState } from "react";
import { builtInFontFamilies } from "../shared/fonts";
import type { PptxTheme } from "../shared/models";

const PPTX_THEME_COLOR_CONTROLS = [
  ["dk1", "Dark 1"],
  ["lt1", "Light 1"],
  ["dk2", "Dark 2"],
  ["lt2", "Light 2"],
  ["accent1", "Accent 1"],
  ["accent2", "Accent 2"],
  ["accent3", "Accent 3"],
  ["accent4", "Accent 4"],
  ["accent5", "Accent 5"],
  ["accent6", "Accent 6"],
  ["hlink", "Link"],
  ["folHlink", "Visited"],
] as const;

export function PptxThemeEditor({
  theme,
  disabled,
  affectedSlideCount,
  onThemeChange,
}: {
  theme?: PptxTheme;
  disabled: boolean;
  affectedSlideCount: number;
  onThemeChange: (patch: Partial<PptxTheme>) => void;
}) {
  const [draft, setDraft] = useState<PptxTheme | undefined>(() =>
    theme ? structuredClone(theme) : undefined,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(theme);

  function updateDraft(patch: Partial<PptxTheme>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] lg:grid-cols-[minmax(10rem,1fr)_10rem_10rem_minmax(0,2fr)]">
      <div className="flex items-center justify-between gap-2 lg:col-span-4">
        <span>
          Global theme draft · affects {affectedSlideCount} slide(s)
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            disabled={disabled || !dirty || !draft}
            onClick={() => draft && onThemeChange(structuredClone(draft))}
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={disabled || !dirty}
            onClick={() => setDraft(theme ? structuredClone(theme) : undefined)}
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
        </span>
      </div>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Theme</span>
        <input
          value={draft?.name ?? ""}
          onChange={(event) => updateDraft({ name: event.currentTarget.value })}
          disabled={disabled}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Major font</span>
        <select
          value={draft?.majorFont ?? ""}
          onChange={(event) =>
            updateDraft({ majorFont: event.currentTarget.value })
          }
          disabled={disabled}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Theme default</option>
          {builtInFontFamilies.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Minor font</span>
        <select
          value={draft?.minorFont ?? ""}
          onChange={(event) =>
            updateDraft({ minorFont: event.currentTarget.value })
          }
          disabled={disabled}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Theme default</option>
          {builtInFontFamilies.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>
      <div className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Theme colors</span>
        <div className="grid grid-cols-6 gap-1 xl:grid-cols-12">
          {PPTX_THEME_COLOR_CONTROLS.map(([key, label]) => (
            <label
              key={key}
              className="grid min-w-0 gap-1 text-[10px] text-[var(--text-muted)]"
              title={label}
            >
              <span className="truncate">{label}</span>
              <input
                type="color"
                value={draft?.colors?.[key] ?? "#000000"}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          colors: {
                            ...(current.colors ?? {}),
                            [key]: event.currentTarget.value,
                          },
                        }
                      : current,
                  )
                }
                disabled={disabled}
                className="h-7 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
