import { builtInFontFamilies } from "./fonts";
import type { PptxTheme } from "./models";

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
  onThemeChange,
  onThemeColorChange,
}: {
  theme?: PptxTheme;
  disabled: boolean;
  onThemeChange: (patch: Partial<PptxTheme>) => void;
  onThemeColorChange: (key: string, color: string) => void;
}) {
  return (
    <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] lg:grid-cols-[minmax(10rem,1fr)_10rem_10rem_minmax(0,2fr)]">
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Theme</span>
        <input
          value={theme?.name ?? ""}
          onChange={(event) => onThemeChange({ name: event.currentTarget.value })}
          disabled={disabled}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Major font</span>
        <select
          value={theme?.majorFont ?? ""}
          onChange={(event) =>
            onThemeChange({ majorFont: event.currentTarget.value })
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
          value={theme?.minorFont ?? ""}
          onChange={(event) =>
            onThemeChange({ minorFont: event.currentTarget.value })
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
                value={theme?.colors?.[key] ?? "#000000"}
                onChange={(event) =>
                  onThemeColorChange(key, event.currentTarget.value)
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
