import { useMemo, useState } from "react";
import { Bold, Italic, Strikethrough, Underline } from "lucide-react";
import { builtInFontFamilies } from "../shared/fonts";
import type { PptxMaster, PptxText } from "../shared/models";
import { ToolbarButton } from "../shared/shared";

export function PptxMasterEditor({
  masters,
  activeMasterPath,
  disabled,
  affectedSlideCounts,
  onMasterChange,
}: {
  masters: PptxMaster[];
  activeMasterPath?: string;
  disabled: boolean;
  affectedSlideCounts: Readonly<Record<string, number>>;
  onMasterChange: (path: string, patch: Partial<PptxMaster>) => void;
}) {
  const initialMaster =
    masters.find((master) => master.path === activeMasterPath) ?? masters[0];
  const [selectedMasterPath, setSelectedMasterPath] = useState(
    initialMaster?.path ?? "",
  );
  const [draftMaster, setDraftMaster] = useState<PptxMaster | undefined>(() =>
    initialMaster ? structuredClone(initialMaster) : undefined,
  );
  const [selectedPlaceholderIndex, setSelectedPlaceholderIndex] = useState(0);
  const effectiveMasterPath = selectedMasterPath || activeMasterPath || "";
  const selectedMaster =
    masters.find((master) => master.path === effectiveMasterPath) ??
    masters.find((master) => master.path === activeMasterPath) ??
    masters[0];
  const effectiveMaster =
    draftMaster?.path === selectedMaster?.path ? draftMaster : selectedMaster;
  const placeholders = effectiveMaster?.placeholderTexts ?? [];
  const selectedPlaceholder =
    placeholders[Math.min(selectedPlaceholderIndex, Math.max(0, placeholders.length - 1))];
  const activeIndex = selectedPlaceholder
    ? Math.min(selectedPlaceholderIndex, Math.max(0, placeholders.length - 1))
    : 0;
  const geometry = useMemo(
    () => ({
      x: selectedPlaceholder?.x ?? 10,
      y: selectedPlaceholder?.y ?? 10,
      width: selectedPlaceholder?.width ?? 80,
      height: selectedPlaceholder?.height ?? 10,
    }),
    [selectedPlaceholder],
  );

  function updatePlaceholder(patch: Partial<PptxText>) {
    if (!effectiveMaster || !selectedPlaceholder) return;
    setDraftMaster({
      ...effectiveMaster,
      placeholderTexts: placeholders.map((placeholder, index) =>
        index === activeIndex ? { ...placeholder, ...patch } : placeholder,
      ),
    });
  }

  const dirty = JSON.stringify(effectiveMaster) !== JSON.stringify(selectedMaster);

  return (
    <div className="grid shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)] xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(16rem,2fr)_minmax(14rem,1.3fr)]">
      <div className="flex items-center justify-between gap-2 xl:col-span-4">
        <span>
          Global master draft · affects{" "}
          {selectedMaster ? (affectedSlideCounts[selectedMaster.path] ?? 0) : 0} slide(s)
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            disabled={disabled || !dirty || !effectiveMaster || !selectedMaster}
            onClick={() =>
              effectiveMaster &&
              selectedMaster &&
              onMasterChange(selectedMaster.path, structuredClone(effectiveMaster))
            }
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={disabled || !dirty}
            onClick={() =>
              setDraftMaster(
                selectedMaster ? structuredClone(selectedMaster) : undefined,
              )
            }
            className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
        </span>
      </div>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Master</span>
        <select
          value={selectedMaster?.path ?? ""}
          onChange={(event) => {
            const nextMaster = masters.find(
              (master) => master.path === event.currentTarget.value,
            );
            if (
              dirty &&
              !window.confirm("Discard the unapplied master changes?")
            ) {
              return;
            }
            setSelectedMasterPath(event.currentTarget.value);
            setDraftMaster(nextMaster ? structuredClone(nextMaster) : undefined);
            setSelectedPlaceholderIndex(0);
          }}
          disabled={disabled || masters.length === 0}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {masters.length === 0 ? (
            <option value="">No master metadata</option>
          ) : (
            masters.map((master) => (
              <option key={master.path} value={master.path}>
                {[master.name ?? master.path, master.themeName].filter(Boolean).join(" · ")}
              </option>
            ))
          )}
        </select>
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Master name</span>
        <input
          value={effectiveMaster?.name ?? ""}
          onChange={(event) => {
            if (!effectiveMaster) return;
            setDraftMaster({ ...effectiveMaster, name: event.currentTarget.value });
          }}
          disabled={disabled || !selectedMaster}
          className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <div className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Placeholder</span>
        <div className="grid min-w-0 grid-cols-[minmax(8rem,0.9fr)_minmax(10rem,1.1fr)] gap-1">
          <select
            value={selectedPlaceholder ? String(activeIndex) : ""}
            onChange={(event) => setSelectedPlaceholderIndex(Number(event.currentTarget.value))}
            disabled={disabled || placeholders.length === 0}
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {placeholders.length === 0 ? (
              <option value="">No placeholders</option>
            ) : (
              placeholders.map((placeholder, index) => (
                <option key={`${placeholder.id}-${index}`} value={index}>
                  {placeholder.placeholderType ?? placeholder.id}
                </option>
              ))
            )}
          </select>
          <input
            value={selectedPlaceholder?.text ?? ""}
            onChange={(event) => updatePlaceholder({ text: event.currentTarget.value })}
            disabled={disabled || !selectedPlaceholder}
            className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
      <div className="grid min-w-0 gap-1">
        <span className="font-medium uppercase tracking-wide">Text style</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <select
            value={selectedPlaceholder?.fontFamily ?? ""}
            onChange={(event) => updatePlaceholder({ fontFamily: event.currentTarget.value })}
            disabled={disabled || !selectedPlaceholder}
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Theme font</option>
            {builtInFontFamilies.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={6}
            max={96}
            value={selectedPlaceholder?.fontSize ?? "18"}
            onChange={(event) => updatePlaceholder({ fontSize: event.currentTarget.value })}
            disabled={disabled || !selectedPlaceholder}
            className="h-8 w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <ToolbarButton
            icon={Bold}
            label="Bold"
            onClick={() => updatePlaceholder({ bold: !selectedPlaceholder?.bold })}
            active={selectedPlaceholder?.bold}
            disabled={disabled || !selectedPlaceholder}
          />
          <ToolbarButton
            icon={Italic}
            label="Italic"
            onClick={() => updatePlaceholder({ italic: !selectedPlaceholder?.italic })}
            active={selectedPlaceholder?.italic}
            disabled={disabled || !selectedPlaceholder}
          />
          <ToolbarButton
            icon={Underline}
            label="Underline"
            onClick={() => updatePlaceholder({ underline: !selectedPlaceholder?.underline })}
            active={selectedPlaceholder?.underline}
            disabled={disabled || !selectedPlaceholder}
          />
          <ToolbarButton
            icon={Strikethrough}
            label="Strikethrough"
            onClick={() =>
              updatePlaceholder({
                strikethrough: !selectedPlaceholder?.strikethrough,
              })
            }
            active={selectedPlaceholder?.strikethrough}
            disabled={disabled || !selectedPlaceholder}
          />
        </div>
      </div>
      <div className="grid min-w-0 gap-1 xl:col-span-4">
        <span className="font-medium uppercase tracking-wide">Placeholder layout</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key} className="flex items-center gap-1">
              <span className="w-4 uppercase text-[10px] text-[var(--text-faint)]">{key}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={geometry[key].toFixed(1)}
                onChange={(event) =>
                  updatePlaceholder({
                    [key]: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)),
                  })
                }
                disabled={disabled || !selectedPlaceholder}
                className="h-8 w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          ))}
          <label className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-[var(--text-faint)]">Text</span>
            <input
              type="color"
              value={selectedPlaceholder?.color ?? "#000000"}
              onChange={(event) => updatePlaceholder({ color: event.currentTarget.value })}
              disabled={disabled || !selectedPlaceholder}
              className="h-8 w-10 rounded border border-[var(--border)] bg-[var(--surface)] p-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-[var(--text-faint)]">Fill</span>
            <input
              type="color"
              value={selectedPlaceholder?.fillColor ?? "#ffffff"}
              onChange={(event) => updatePlaceholder({ fillColor: event.currentTarget.value })}
              disabled={disabled || !selectedPlaceholder}
              className="h-8 w-10 rounded border border-[var(--border)] bg-[var(--surface)] p-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
