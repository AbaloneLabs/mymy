import type { ComponentType } from "react";
import { Keyboard, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { builtInFontFamilies, editorFontBlobUrl, useEditorFonts } from "./fonts";
import { editorCommandsForKind } from "./commands";
import { cn } from "@/lib/utils";
import type { DocumentEditorKind } from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

export function FontFamilySelect({
  value,
  onChange,
  compact = false,
}: {
  value?: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const fonts = useEditorFonts();
  const customFonts = fonts.data?.fonts ?? [];
  return (
    <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
      <Type className="h-3.5 w-3.5" strokeWidth={1.75} />
      <select
        value={value || builtInFontFamilies[0]}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]",
          compact ? "w-32" : "w-44",
        )}
      >
        {builtInFontFamilies.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
        {customFonts.length > 0 && (
          <optgroup label="Custom fonts">
            {customFonts.map((font) => (
              <option key={font.id} value={font.displayName}>
                {font.displayName}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

export function EditorFontFaces() {
  const fonts = useEditorFonts();
  const css = (fonts.data?.fonts ?? [])
    .map((font) => {
      const family = font.displayName.replace(/["\\]/g, "");
      return `@font-face{font-family:"${family}";src:url("${editorFontBlobUrl(font)}") format("${fontFormat(font.mimeType)}");font-display:swap;}`;
    })
    .join("\n");
  if (!css) return null;
  return <style>{css}</style>;
}

export function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-[var(--surface-hover)] text-[var(--accent)]",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}

export function ShortcutHelp({
  kind,
  keymap = [],
}: {
  kind: DocumentEditorKind;
  keymap?: EditorKeymapEntry[];
}) {
  const { t } = useTranslation();
  const shortcuts = editorCommandsForKind(kind, keymap).flatMap((command) =>
    command.shortcuts.map((shortcut) => ({
      keys: shortcut.display,
      label: t(command.labelKey, { defaultValue: command.fallbackLabel }),
    })),
  );
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
        <Keyboard className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.shortcuts", { defaultValue: "Shortcuts" })}
      </div>
      <div className="grid gap-1 text-[11px] text-[var(--text-muted)] sm:grid-cols-2 lg:grid-cols-3">
        {shortcuts.map((shortcut) => (
          <div
            key={`${shortcut.keys}:${shortcut.label}`}
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
          >
            <span>{shortcut.label}</span>
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

function fontFormat(mimeType: string) {
  if (mimeType === "font/ttf") return "truetype";
  if (mimeType === "font/otf") return "opentype";
  if (mimeType === "font/woff") return "woff";
  if (mimeType === "font/woff2") return "woff2";
  return "truetype";
}
