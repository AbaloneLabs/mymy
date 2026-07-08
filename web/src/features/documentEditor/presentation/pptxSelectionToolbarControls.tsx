import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Copy,
  Group,
  SendToBack,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PptxEditorToolbarProps } from "./pptxEditorToolbarTypes";

type PptxSelectionToolbarControlsProps = Pick<
  PptxEditorToolbarProps,
  | "activeLayerIndex"
  | "activeLayerLength"
  | "activeObject"
  | "canUngroupSelection"
  | "hasMultiSelection"
  | "hasObjectSelection"
  | "onAlignActiveObject"
  | "onDeleteSelectedObjects"
  | "onDistributeSelectedObjects"
  | "onDuplicateSelectedObjects"
  | "onGroupSelectedObjects"
  | "onMoveActiveObjectLayer"
  | "onUngroupSelectedObjects"
  | "selectedObjectCount"
  | "slide"
>;

export function PptxSelectionToolbarControls({
  activeLayerIndex,
  activeLayerLength,
  activeObject,
  canUngroupSelection,
  hasMultiSelection,
  hasObjectSelection,
  onAlignActiveObject,
  onDeleteSelectedObjects,
  onDistributeSelectedObjects,
  onDuplicateSelectedObjects,
  onGroupSelectedObjects,
  onMoveActiveObjectLayer,
  onUngroupSelectedObjects,
  selectedObjectCount,
  slide,
}: PptxSelectionToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        onClick={onDuplicateSelectedObjects}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Duplicate selected object"
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteSelectedObjects}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete selected object"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onGroupSelectedObjects}
        disabled={selectedObjectCount < 2}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.commands.group", { defaultValue: "Group" })}
      >
        <Group className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onUngroupSelectedObjects}
        disabled={!canUngroupSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.commands.ungroup", { defaultValue: "Ungroup" })}
      >
        <Ungroup className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveActiveObjectLayer(-1)}
        disabled={!activeObject || hasMultiSelection || activeLayerIndex <= 0}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Send backward"
      >
        <SendToBack className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onMoveActiveObjectLayer(1)}
        disabled={
          !activeObject ||
          hasMultiSelection ||
          !slide ||
          activeLayerIndex >= activeLayerLength - 1
        }
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Bring forward"
      >
        <BringToFront className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("left")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to left edge"
      >
        <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("center")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to horizontal center"
      >
        <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("right")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to right edge"
      >
        <AlignRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("top")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to top edge"
      >
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("middle")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to vertical middle"
      >
        <AlignCenter className="h-3.5 w-3.5 rotate-90" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onAlignActiveObject("bottom")}
        disabled={!hasObjectSelection}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Align to bottom edge"
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => onDistributeSelectedObjects("horizontal")}
        disabled={selectedObjectCount <= 2}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Distribute horizontally"
      >
        Dist H
      </button>
      <button
        type="button"
        onClick={() => onDistributeSelectedObjects("vertical")}
        disabled={selectedObjectCount <= 2}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Distribute vertically"
      >
        Dist V
      </button>
    </>
  );
}
