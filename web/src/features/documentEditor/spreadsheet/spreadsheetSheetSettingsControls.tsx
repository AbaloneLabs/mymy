import { Lock, Printer } from "lucide-react";
import type {
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheetProtection,
} from "../shared/models";

export function SpreadsheetSheetSettingsControls({
  protection,
  pageMargins,
  pageSetup,
  onChange,
}: {
  protection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  onChange: (patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) => void;
}) {
  const margins = pageMargins ?? {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0.3,
    footer: 0.3,
  };
  const setup: XlsxPageSetup = pageSetup ?? {
    orientation: "portrait",
    paperSize: 9,
    scale: 100,
  };

  function updateProtection(patch: Partial<XlsxSheetProtection>) {
    const enabled = patch.enabled ?? protection?.enabled ?? false;
    onChange({
      protection: enabled
        ? {
            enabled,
            password: protection?.password,
            objects: patch.objects ?? protection?.objects ?? true,
            scenarios: patch.scenarios ?? protection?.scenarios ?? true,
            formatCells: patch.formatCells ?? protection?.formatCells ?? false,
            formatColumns:
              patch.formatColumns ?? protection?.formatColumns ?? false,
            formatRows: patch.formatRows ?? protection?.formatRows ?? false,
            insertColumns:
              patch.insertColumns ?? protection?.insertColumns ?? false,
            insertRows: patch.insertRows ?? protection?.insertRows ?? false,
            insertHyperlinks:
              patch.insertHyperlinks ?? protection?.insertHyperlinks ?? false,
            deleteColumns:
              patch.deleteColumns ?? protection?.deleteColumns ?? false,
            deleteRows: patch.deleteRows ?? protection?.deleteRows ?? false,
            sort: patch.sort ?? protection?.sort ?? false,
            autoFilter: patch.autoFilter ?? protection?.autoFilter ?? false,
            pivotTables: patch.pivotTables ?? protection?.pivotTables ?? false,
          }
        : undefined,
    });
  }

  function updateMargins(patch: Partial<XlsxPageMargins>) {
    onChange({ pageMargins: { ...margins, ...patch } });
  }

  function updateSetup(patch: Partial<XlsxPageSetup>) {
    onChange({ pageSetup: { ...setup, ...patch } });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <label className="inline-flex h-7 items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={protection?.enabled === true}
          onChange={(event) =>
            updateProtection({ enabled: event.currentTarget.checked })
          }
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
        Protect
      </label>
      {protection?.enabled && (
        <>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.autoFilter === true}
              onChange={(event) =>
                updateProtection({ autoFilter: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Block filter
          </label>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.sort === true}
              onChange={(event) =>
                updateProtection({ sort: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Block sort
          </label>
        </>
      )}
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <Printer className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={setup.orientation ?? "portrait"}
        onChange={(event) =>
          updateSetup({
            orientation: event.currentTarget.value as XlsxPageSetup["orientation"],
          })
        }
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title="Print orientation"
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Scale
        <input
          type="number"
          min={10}
          max={400}
          step={5}
          value={setup.scale ?? 100}
          onChange={(event) => updateSetup({ scale: Number(event.target.value) })}
          className="h-6 w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Margin
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.left ?? 0.7}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ left: value, right: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Left and right margins"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Top
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.top ?? 0.75}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ top: value, bottom: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Top and bottom margins"
        />
      </label>
    </div>
  );
}
