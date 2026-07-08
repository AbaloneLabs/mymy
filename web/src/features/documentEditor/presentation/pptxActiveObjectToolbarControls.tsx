import type {
  PptxChart,
  PptxImage,
  PptxModel,
  PptxTable,
} from "../shared/models";
import { PercentInput } from "./pptxPercentInput";
import type { PptxGeometryPatch, PptxObject } from "./pptxSelection";
import { PptxTableFlagToggle } from "./pptxToolbarControls";

type PptxImageCropKey = keyof Pick<
  PptxImage,
  "imageCropLeft" | "imageCropTop" | "imageCropRight" | "imageCropBottom"
>;

const PPTX_IMAGE_CROP_CONTROLS: Array<{
  key: PptxImageCropKey;
  label: string;
}> = [
  { key: "imageCropLeft", label: "CL" },
  { key: "imageCropTop", label: "CT" },
  { key: "imageCropRight", label: "CR" },
  { key: "imageCropBottom", label: "CB" },
];

const PPTX_CHART_TYPE_OPTIONS = [
  "bar",
  "line",
  "area",
  "pie",
  "doughnut",
] as const;
const PPTX_DEFAULT_TABLE_STYLE_ID = "{5940675A-B579-460E-94D1-54222C63F5DA}";

export function PptxActiveObjectToolbarControls({
  model,
  activeObject,
  activeImage,
  activeTable,
  activeChart,
  hasMultiSelection,
  selectedObjectCount,
  onUpdateActiveObjectGeometry,
  onUpdateActiveImage,
  onUpdateActiveTable,
  onUpdateActiveChart,
}: {
  model: PptxModel;
  activeObject: PptxObject | undefined;
  activeImage: PptxImage | undefined;
  activeTable: PptxTable | undefined;
  activeChart: PptxChart | undefined;
  hasMultiSelection: boolean;
  selectedObjectCount: number;
  onUpdateActiveObjectGeometry: (patch: PptxGeometryPatch) => void;
  onUpdateActiveImage: (patch: Partial<PptxImage>) => void;
  onUpdateActiveTable: (patch: Partial<PptxTable>) => void;
  onUpdateActiveChart: (patch: Partial<PptxChart>) => void;
}) {
  const tableStyleOptions = buildPptxTableStyleOptions(model, activeTable);

  function updateActiveImageCrop(key: PptxImageCropKey, value: number) {
    onUpdateActiveImage({ [key]: clampPptxCropPercent(value) });
  }

  if (hasMultiSelection) {
    return (
      <div className="ml-auto rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
        {selectedObjectCount} selected
      </div>
    );
  }

  if (!activeObject) return null;

  return (
    <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
      {activeImage && (
        <input
          value={activeImage.altText ?? ""}
          onChange={(event) =>
            onUpdateActiveImage({ altText: event.target.value })
          }
          placeholder="Alt text"
          className="h-8 w-36 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      )}
      {activeChart && (
        <>
          <select
            value={
              PPTX_CHART_TYPE_OPTIONS.includes(
                activeChart.type as (typeof PPTX_CHART_TYPE_OPTIONS)[number],
              )
                ? activeChart.type
                : "bar"
            }
            onChange={(event) =>
              onUpdateActiveChart({ type: event.currentTarget.value })
            }
            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Chart type"
          >
            {PPTX_CHART_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            value={activeChart.title ?? ""}
            onChange={(event) =>
              onUpdateActiveChart({ title: event.target.value })
            }
            placeholder="Chart title"
            className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </>
      )}
      {activeTable && (
        <>
          <select
            value={activeTable.tableStyleId ?? PPTX_DEFAULT_TABLE_STYLE_ID}
            onChange={(event) =>
              onUpdateActiveTable({ tableStyleId: event.currentTarget.value })
            }
            className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Table style"
          >
            {tableStyleOptions.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
          <PptxTableFlagToggle
            label="Header"
            checked={activeTable.firstRow !== false}
            onChange={(firstRow) => onUpdateActiveTable({ firstRow })}
          />
          <PptxTableFlagToggle
            label="Total"
            checked={Boolean(activeTable.lastRow)}
            onChange={(lastRow) => onUpdateActiveTable({ lastRow })}
          />
          <PptxTableFlagToggle
            label="First col"
            checked={Boolean(activeTable.firstColumn)}
            onChange={(firstColumn) => onUpdateActiveTable({ firstColumn })}
          />
          <PptxTableFlagToggle
            label="Last col"
            checked={Boolean(activeTable.lastColumn)}
            onChange={(lastColumn) => onUpdateActiveTable({ lastColumn })}
          />
          <PptxTableFlagToggle
            label="Banded rows"
            checked={activeTable.bandedRows !== false}
            onChange={(bandedRows) => onUpdateActiveTable({ bandedRows })}
          />
          <PptxTableFlagToggle
            label="Banded cols"
            checked={Boolean(activeTable.bandedColumns)}
            onChange={(bandedColumns) =>
              onUpdateActiveTable({ bandedColumns })
            }
          />
        </>
      )}
      <PercentInput
        label="X"
        value={activeObject.x ?? 10}
        onChange={(x) => onUpdateActiveObjectGeometry({ x })}
      />
      <PercentInput
        label="Y"
        value={activeObject.y ?? 12}
        onChange={(y) => onUpdateActiveObjectGeometry({ y })}
      />
      <PercentInput
        label="W"
        value={activeObject.width ?? 80}
        onChange={(width) => onUpdateActiveObjectGeometry({ width })}
      />
      <PercentInput
        label="H"
        value={activeObject.height ?? 10}
        onChange={(height) => onUpdateActiveObjectGeometry({ height })}
      />
      <PercentInput
        label="R"
        value={activeObject.rotation ?? 0}
        min={0}
        max={359}
        onChange={(rotation) => onUpdateActiveObjectGeometry({ rotation })}
      />
      {activeImage &&
        PPTX_IMAGE_CROP_CONTROLS.map((control) => (
          <PercentInput
            key={control.key}
            label={control.label}
            value={activeImage[control.key] ?? 0}
            min={0}
            max={95}
            onChange={(value) => updateActiveImageCrop(control.key, value)}
          />
        ))}
    </div>
  );
}

function buildPptxTableStyleOptions(
  model: PptxModel,
  activeTable: PptxTable | undefined,
) {
  const options = new Map<string, string>();
  options.set(PPTX_DEFAULT_TABLE_STYLE_ID, "Default");
  for (const style of model.tableStyles ?? []) {
    options.set(style.id, style.name ?? style.id);
  }
  if (activeTable?.tableStyleId && !options.has(activeTable.tableStyleId)) {
    options.set(activeTable.tableStyleId, "Current style");
  }
  return [...options.entries()].map(([id, name]) => ({ id, name }));
}

function clampPptxCropPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(95, value));
}
