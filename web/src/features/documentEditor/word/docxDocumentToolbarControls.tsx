import {
  ChevronDown,
  ChevronUp,
  FileText,
  Heading1,
  Image as ImageIcon,
  ListTree,
  Paintbrush,
  Plus,
  Table,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ToolbarButton } from "../shared/shared";
import type { DocxEditorToolbarProps } from "./docxEditorToolbarTypes";

type DocxDocumentToolbarControlsProps = Pick<
  DocxEditorToolbarProps,
  | "hasDocumentParts"
  | "imageInputRef"
  | "onAddBlock"
  | "onDeleteActiveBlock"
  | "onInsertImageFile"
  | "onInsertPageBreak"
  | "onInsertSectionBreak"
  | "onMoveActiveBlock"
  | "onToggleOutlineOpen"
  | "onToggleStylesOpen"
  | "onToggleTextPartsOpen"
  | "outlineOpen"
  | "stylesOpen"
  | "textPartsOpen"
>;

export function DocxDocumentToolbarControls({
  hasDocumentParts,
  imageInputRef,
  onAddBlock,
  onDeleteActiveBlock,
  onInsertImageFile,
  onInsertPageBreak,
  onInsertSectionBreak,
  onMoveActiveBlock,
  onToggleOutlineOpen,
  onToggleStylesOpen,
  onToggleTextPartsOpen,
  outlineOpen,
  stylesOpen,
  textPartsOpen,
}: DocxDocumentToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <ToolbarButton
        icon={ListTree}
        label="Outline"
        onClick={onToggleOutlineOpen}
        active={outlineOpen}
      />
      <ToolbarButton
        icon={Paintbrush}
        label="Styles"
        onClick={onToggleStylesOpen}
        active={stylesOpen}
      />
      {hasDocumentParts && (
        <>
          <button
            type="button"
            onClick={onToggleTextPartsOpen}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              textPartsOpen && "border-[var(--accent)] text-[var(--accent)]",
            )}
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            Parts
          </button>
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        </>
      )}
      <ToolbarButton
        icon={ChevronUp}
        label="Move up"
        onClick={() => onMoveActiveBlock(-1)}
      />
      <ToolbarButton
        icon={ChevronDown}
        label="Move down"
        onClick={() => onMoveActiveBlock(1)}
      />
      <ToolbarButton
        icon={Trash2}
        label={t("common.delete")}
        onClick={onDeleteActiveBlock}
      />
      <div className="ml-auto flex items-center gap-1">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onInsertImageFile(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          Image
        </button>
        <button
          type="button"
          onClick={() => onAddBlock("heading")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Heading1 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Heading
        </button>
        <button
          type="button"
          onClick={() => onAddBlock("table")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          Table
        </button>
        <button
          type="button"
          onClick={onInsertPageBreak}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
          Page break
        </button>
        <button
          type="button"
          onClick={onInsertSectionBreak}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
          Section break
        </button>
        <button
          type="button"
          onClick={() => onAddBlock("paragraph")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.addParagraph")}
        </button>
      </div>
    </>
  );
}
