import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { Move } from "lucide-react";
import { cn } from "@/lib/utils";
import { builtInFontFamilies } from "../shared/fonts";
import type {
  PptxChart,
  PptxImage,
  PptxShape,
  PptxSlide,
  PptxTableCellStyle,
} from "../shared/models";
import {
  PPTX_SNAP_GRID_PERCENT,
  isPptxLineShape,
  pptxChartStyle,
  pptxImageStyle,
  pptxSlideBackgroundStyle,
} from "./pptxEditorUtils";
import type { PptxSnapGuide, SlideDragState } from "./pptxEditorUtils";
import {
  pptxSelectionKey,
} from "./pptxSelection";
import type { PptxObject, PptxSelectionKey } from "./pptxSelection";
import { PptxChartView } from "./pptxChartView";
import { PptxImageView, PptxShapeView } from "./pptxShapeViews";
import { PptxEditableTable } from "./pptxTablePanels";

type PptxSelectionBoxBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function PptxSlideCanvas({
  canvasRef,
  slide,
  slideAspectRatio,
  selectionBoxBounds,
  snapGuides,
  showSnapGrid,
  activeTextId,
  activeShapeId,
  activeImageId,
  activeTableId,
  activeChartId,
  selectedKeys,
  onCanvasKeyDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasPointerDown,
  onTextKeyDown,
  onSelectText,
  onSelectShape,
  onSelectImage,
  onSelectTable,
  onSelectChart,
  onStartObjectDrag,
  onTextChange,
  onTableCellChange,
  onAddTableRow,
  onAddTableColumn,
  onDeleteTableRow,
  onDeleteTableColumn,
  onTableColumnWidthChange,
  onTableRowHeightChange,
  onTableCellStyleChange,
  onAddSlide,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  slide: PptxSlide | undefined;
  slideAspectRatio: number;
  selectionBoxBounds: PptxSelectionBoxBounds | null;
  snapGuides: PptxSnapGuide[];
  showSnapGrid: boolean;
  activeTextId: string | null;
  activeShapeId: string | null;
  activeImageId: string | null;
  activeTableId: string | null;
  activeChartId: string | null;
  selectedKeys: ReadonlySet<PptxSelectionKey>;
  onCanvasKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCanvasPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onCanvasPointerUp: () => void;
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSelectText: (textId: string | null, additive?: boolean) => void;
  onSelectShape: (shapeId: string | null, additive?: boolean) => void;
  onSelectImage: (imageId: string | null, additive?: boolean) => void;
  onSelectTable: (tableId: string | null, additive?: boolean) => void;
  onSelectChart: (chartId: string | null, additive?: boolean) => void;
  onStartObjectDrag: (
    event: ReactPointerEvent<HTMLElement>,
    objectKind: SlideDragState["objectKind"],
    object: PptxObject,
    mode: SlideDragState["mode"],
  ) => void;
  onTextChange: (textIndex: number, text: string) => void;
  onTableCellChange: (
    tableId: string,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => void;
  onAddTableRow: (tableId: string, rowIndex: number) => void;
  onAddTableColumn: (tableId: string, columnIndex: number) => void;
  onDeleteTableRow: (tableId: string, rowIndex: number) => void;
  onDeleteTableColumn: (tableId: string, columnIndex: number) => void;
  onTableColumnWidthChange: (
    tableId: string,
    columnIndex: number,
    value: number,
  ) => void;
  onTableRowHeightChange: (
    tableId: string,
    rowIndex: number,
    value: number,
  ) => void;
  onTableCellStyleChange: (
    tableId: string,
    rowIndex: number,
    columnIndex: number,
    patch: Partial<PptxTableCellStyle>,
  ) => void;
  onAddSlide: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div
        className="mx-auto max-w-4xl border border-[var(--border)] shadow-sm"
        style={{
          ...pptxSlideBackgroundStyle(slide),
          aspectRatio: slideAspectRatio,
        }}
      >
        <div
          ref={canvasRef}
          tabIndex={0}
          className="relative h-full w-full overflow-hidden outline-none"
          onKeyDown={onCanvasKeyDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerLeave={onCanvasPointerUp}
          onPointerDown={onCanvasPointerDown}
        >
          {showSnapGrid && (
            <div
              className="pointer-events-none absolute inset-0 z-0 opacity-30"
              style={{
                backgroundImage:
                  "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                backgroundSize: `${PPTX_SNAP_GRID_PERCENT * 5}% ${PPTX_SNAP_GRID_PERCENT * 5}%`,
              }}
            />
          )}
          {snapGuides.map((guide, index) => (
            <div
              key={`${guide.orientation}-${guide.position}-${index}`}
              className="pointer-events-none absolute z-[9998] bg-[var(--accent)]/60"
              style={
                guide.orientation === "vertical"
                  ? {
                      left: `${guide.position}%`,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      transform: "translateX(-0.5px)",
                    }
                  : {
                      top: `${guide.position}%`,
                      left: 0,
                      right: 0,
                      height: 1,
                      transform: "translateY(-0.5px)",
                    }
              }
            />
          ))}
          {selectionBoxBounds && (
            <div
              className="pointer-events-none absolute z-[9999] border border-[var(--accent)] bg-[var(--accent)]/10"
              style={{
                left: `${selectionBoxBounds.left}%`,
                top: `${selectionBoxBounds.top}%`,
                width: `${selectionBoxBounds.width}%`,
                height: `${selectionBoxBounds.height}%`,
              }}
            />
          )}
          {(slide?.shapes ?? []).map((shape, index) => {
            const selected =
              activeShapeId === shape.id ||
              selectedKeys.has(pptxSelectionKey("shape", shape.id));
            return (
              <div
                key={shape.id}
                role="button"
                tabIndex={0}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectShape(
                    shape.id,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                onKeyDown={onTextKeyDown}
                className={cn(
                  "absolute outline-none",
                  selected && "ring-2 ring-[var(--accent)]/40",
                )}
                style={{
                  left: `${shape.x ?? 24}%`,
                  top: `${shape.y ?? 34}%`,
                  width: `${shape.width ?? 26}%`,
                  height: `${isPptxLineShape(shape) ? Math.max(1, shape.height ?? 0) : shape.height ?? 20}%`,
                  transform: `rotate(${shape.rotation ?? 0}deg)`,
                  zIndex: index + 1,
                }}
              >
                <PptxShapeView shape={shape} />
                <PptxObjectHandles
                  selected={selected}
                  label="Move shape"
                  objectKind="shape"
                  object={shape}
                  onStartObjectDrag={onStartObjectDrag}
                />
              </div>
            );
          })}
          {(slide?.images ?? []).map((image, index) => {
            const selected =
              activeImageId === image.id ||
              selectedKeys.has(pptxSelectionKey("image", image.id));
            return (
              <div
                key={image.id}
                role="button"
                tabIndex={0}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectImage(
                    image.id,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                onKeyDown={onTextKeyDown}
                className={cn(
                  "absolute outline-none",
                  selected && "ring-2 ring-[var(--accent)]/40",
                )}
                style={pptxImageStyle(
                  image,
                  (slide?.shapes?.length ?? 0) + index + 1,
                )}
              >
                <PptxImageView image={image} />
                <PptxObjectHandles
                  selected={selected}
                  label="Move image"
                  objectKind="image"
                  object={image}
                  onStartObjectDrag={onStartObjectDrag}
                />
              </div>
            );
          })}
          {(slide?.charts ?? []).map((chart, index) => {
            const selected =
              activeChartId === chart.id ||
              selectedKeys.has(pptxSelectionKey("chart", chart.id));
            return (
              <div
                key={chart.id}
                role="button"
                tabIndex={0}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectChart(
                    chart.id,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                onKeyDown={onTextKeyDown}
                className={cn(
                  "absolute outline-none",
                  selected && "ring-2 ring-[var(--accent)]/40",
                )}
                style={pptxChartStyle(
                  chart,
                  (slide?.shapes?.length ?? 0) +
                    (slide?.images?.length ?? 0) +
                    index +
                    1,
                )}
              >
                <PptxChartView chart={chart} />
                <PptxObjectHandles
                  selected={selected}
                  label="Move chart"
                  objectKind="chart"
                  object={chart}
                  onStartObjectDrag={onStartObjectDrag}
                />
              </div>
            );
          })}
          {(slide?.tables ?? []).map((table, index) => {
            const selected =
              activeTableId === table.id ||
              selectedKeys.has(pptxSelectionKey("table", table.id));
            return (
              <PptxEditableTable
                key={table.id}
                table={table}
                selected={selected}
                zIndex={
                  (slide?.shapes?.length ?? 0) +
                  (slide?.images?.length ?? 0) +
                  (slide?.charts?.length ?? 0) +
                  index +
                  1
                }
                onSelect={(event) =>
                  onSelectTable(
                    table.id,
                    Boolean(
                      event &&
                        (event.shiftKey || event.metaKey || event.ctrlKey),
                    ),
                  )
                }
                onStartMove={(event) =>
                  onStartObjectDrag(event, "table", table, "move")
                }
                onStartResize={(event) =>
                  onStartObjectDrag(event, "table", table, "resize")
                }
                onKeyDown={onTextKeyDown}
                onCellChange={(rowIndex, columnIndex, value) =>
                  onTableCellChange(table.id, rowIndex, columnIndex, value)
                }
                onAddRow={(rowIndex) => onAddTableRow(table.id, rowIndex)}
                onAddColumn={(columnIndex) => onAddTableColumn(table.id, columnIndex)}
                onDeleteRow={(rowIndex) => onDeleteTableRow(table.id, rowIndex)}
                onDeleteColumn={(columnIndex) =>
                  onDeleteTableColumn(table.id, columnIndex)
                }
                onColumnWidthChange={(columnIndex, value) =>
                  onTableColumnWidthChange(table.id, columnIndex, value)
                }
                onRowHeightChange={(rowIndex, value) =>
                  onTableRowHeightChange(table.id, rowIndex, value)
                }
                onCellStyleChange={(rowIndex, columnIndex, patch) =>
                  onTableCellStyleChange(table.id, rowIndex, columnIndex, patch)
                }
              />
            );
          })}
          {slide?.texts.map((textItem, index) => {
            const selected =
              activeTextId === textItem.id ||
              selectedKeys.has(pptxSelectionKey("text", textItem.id));
            return (
              <div
                key={textItem.id}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectText(
                    textItem.id,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                className={cn(
                  "absolute rounded-sm border border-transparent text-neutral-950 outline-none hover:border-neutral-300",
                  selected &&
                    "border-[var(--accent)] ring-2 ring-[var(--accent)]/30",
                )}
                style={{
                  left: `${textItem.x ?? 10}%`,
                  top: `${textItem.y ?? 12 + index * 18}%`,
                  width: `${textItem.width ?? 80}%`,
                  height: `${textItem.height ?? 10}%`,
                  transform: `rotate(${textItem.rotation ?? 0}deg)`,
                  zIndex:
                    (slide?.shapes?.length ?? 0) +
                    (slide?.images?.length ?? 0) +
                    (slide?.charts?.length ?? 0) +
                    (slide?.tables?.length ?? 0) +
                    index +
                    1,
                }}
              >
                {selected && (
                  <button
                    type="button"
                    onPointerDown={(event) =>
                      onStartObjectDrag(event, "text", textItem, "move")
                    }
                    className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
                    title="Move text box"
                  >
                    <Move className="h-3 w-3" strokeWidth={1.75} />
                    Move
                  </button>
                )}
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onFocus={() => onSelectText(textItem.id)}
                  onKeyDown={onTextKeyDown}
                  onInput={(event) =>
                    onTextChange(index, event.currentTarget.textContent ?? "")
                  }
                  className="h-full min-h-8 w-full px-2 py-1 outline-none"
                  style={{
                    fontFamily:
                      textItem.fontFamily ?? builtInFontFamilies[0],
                    fontSize: `${textItem.fontSize ?? (index === 0 ? "28" : "18")}px`,
                    fontWeight: textItem.bold ? 700 : index === 0 ? 600 : 400,
                    fontStyle: textItem.italic ? "italic" : undefined,
                    textDecorationLine: [
                      textItem.underline ? "underline" : "",
                      textItem.strikethrough ? "line-through" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                    textAlign: textItem.align ?? "left",
                    color: textItem.color,
                    backgroundColor: textItem.fillColor,
                  }}
                >
                  {textItem.text}
                </div>
                {selected && (
                  <button
                    type="button"
                    onPointerDown={(event) =>
                      onStartObjectDrag(event, "text", textItem, "resize")
                    }
                    className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
                    title="Resize text box"
                  />
                )}
              </div>
            );
          })}
          {!slide && (
            <button
              type="button"
              onClick={onAddSlide}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500"
            >
              New slide
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PptxObjectHandles({
  selected,
  label,
  objectKind,
  object,
  onStartObjectDrag,
}: {
  selected: boolean;
  label: string;
  objectKind: Exclude<SlideDragState["objectKind"], "text" | "table">;
  object: PptxShape | PptxImage | PptxChart;
  onStartObjectDrag: (
    event: ReactPointerEvent<HTMLElement>,
    objectKind: SlideDragState["objectKind"],
    object: PptxObject,
    mode: SlideDragState["mode"],
  ) => void;
}) {
  if (!selected) return null;
  return (
    <>
      <button
        type="button"
        onPointerDown={(event) =>
          onStartObjectDrag(event, objectKind, object, "move")
        }
        className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
        title={label}
      >
        <Move className="h-3 w-3" strokeWidth={1.75} />
        Move
      </button>
      <button
        type="button"
        onPointerDown={(event) =>
          onStartObjectDrag(event, objectKind, object, "resize")
        }
        className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
        title={label.replace("Move", "Resize")}
      />
    </>
  );
}
