import { Plus, Trash2 } from "lucide-react";
import { builtInFontFamilies } from "../shared/fonts";
import type { DocxBlock, DocxStyle } from "../shared/models";
import { isDocxTextBlock } from "./docxEditorUtils";

export function DocxStylePanel({
  activeBlock,
  styles,
  onCreateFromActive,
  onDeleteStyle,
  onStyleChange,
}: {
  activeBlock: DocxBlock | undefined;
  styles: DocxStyle[];
  onCreateFromActive: (name: string) => void;
  onDeleteStyle: (styleId: string) => void;
  onStyleChange: (styleId: string, patch: Partial<DocxStyle>) => void;
}) {
  return (
    <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] xl:grid-cols-[16rem_minmax(0,1fr)]">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const input = form.elements.namedItem("styleName");
          if (!(input instanceof HTMLInputElement)) return;
          onCreateFromActive(input.value);
          input.value = "";
        }}
      >
        <input
          name="styleName"
          placeholder="New style from selection"
          disabled={!isDocxTextBlock(activeBlock)}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isDocxTextBlock(activeBlock)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add
        </button>
      </form>
      <div className="min-w-0 overflow-x-auto">
        <div className="flex min-w-max gap-2">
          {styles.map((style) => (
            <StyleEditor
              key={style.id}
              styles={styles}
              style={style}
              onChange={(patch) => onStyleChange(style.id, patch)}
              onDelete={() => onDeleteStyle(style.id)}
            />
          ))}
          {styles.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-[var(--text-faint)]">
              No editable paragraph styles
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StyleEditor({
  styles,
  style,
  onChange,
  onDelete,
}: {
  styles: DocxStyle[];
  style: DocxStyle;
  onChange: (patch: Partial<DocxStyle>) => void;
  onDelete: () => void;
}) {
  const inheritedStyleOptions = styles.filter((item) => item.id !== style.id);
  return (
    <div className="grid min-w-[34rem] gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_8rem_auto] items-center gap-1">
        <input
          value={style.name}
          onChange={(event) => onChange({ name: event.target.value })}
          className="h-7 min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <input
          type="number"
          min={6}
          max={96}
          value={style.fontSize ?? ""}
          onChange={(event) =>
            onChange({ fontSize: event.target.value || undefined })
          }
          className="h-7 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Font size"
        />
        <select
          value={style.fontFamily ?? ""}
          onChange={(event) => onChange({ fontFamily: event.target.value || undefined })}
          className="h-7 min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Font family"
        >
          <option value="">Theme font</option>
          {builtInFontFamilies.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <StyleToggle label="B" active={style.bold} onClick={() => onChange({ bold: !style.bold })} />
          <StyleToggle
            label="I"
            active={style.italic}
            onClick={() => onChange({ italic: !style.italic })}
          />
          <StyleToggle
            label="U"
            active={style.underline}
            onClick={() => onChange({ underline: !style.underline })}
          />
          <input
            type="color"
            value={style.color ?? "#111827"}
            onChange={(event) => onChange({ color: event.target.value })}
            className="h-7 w-8 rounded border border-[var(--border)] bg-[var(--surface)] p-1"
            title="Text color"
          />
          <button
            type="button"
            onClick={onDelete}
            disabled={!style.custom}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-35"
            title="Delete custom style"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_auto] items-center gap-1">
        <select
          value={style.basedOn ?? ""}
          onChange={(event) => onChange({ basedOn: event.target.value || undefined })}
          className="h-7 min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Based on"
        >
          <option value="">No base style</option>
          {inheritedStyleOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={style.next ?? ""}
          onChange={(event) => onChange({ next: event.target.value || undefined })}
          className="h-7 min-w-0 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Next paragraph style"
        >
          <option value="">Same style</option>
          {styles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={style.align ?? ""}
          onChange={(event) =>
            onChange({
              align: (event.target.value || undefined) as DocxStyle["align"],
            })
          }
          className="h-7 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Paragraph alignment"
        >
          <option value="">Inherit align</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
        <label className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={Boolean(style.quickFormat)}
            onChange={(event) => onChange({ quickFormat: event.target.checked })}
          />
          Quick
        </label>
      </div>
    </div>
  );
}

function StyleToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded border text-[11px] font-semibold",
        active
          ? "border-[var(--accent)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
