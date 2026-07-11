import {
  Bookmark,
  Bold,
  Copy,
  Eraser,
  FileText,
  Highlighter,
  Italic,
  Link,
  Palette,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  headingFontSize,
  isDocxTextBlock,
} from "./docxEditorUtils";
import { DocxBlockTypeSelect } from "./docxBlockTypeSelect";
import { FontFamilySelect, ToolbarButton } from "../shared/shared";
import type { DocxEditorToolbarProps } from "./docxEditorToolbarTypes";

type DocxTextToolbarControlsProps = Pick<
  DocxEditorToolbarProps,
  | "activeBlock"
  | "canPasteFormatting"
  | "linkDraft"
  | "linkInputOpen"
  | "onApplyLinkDraft"
  | "onApplyNormalStyle"
  | "onCopyActiveFormatting"
  | "onOpenLinkEditor"
  | "onPasteActiveFormatting"
  | "onSetLinkDraft"
  | "onToggleActiveVerticalAlign"
  | "onUpdateActive"
  | "paragraphStyles"
>;

export function DocxTextToolbarControls({
  activeBlock,
  canPasteFormatting,
  linkDraft,
  linkInputOpen,
  onApplyLinkDraft,
  onApplyNormalStyle,
  onCopyActiveFormatting,
  onOpenLinkEditor,
  onPasteActiveFormatting,
  onSetLinkDraft,
  onToggleActiveVerticalAlign,
  onUpdateActive,
  paragraphStyles,
}: DocxTextToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
      <DocxBlockTypeSelect
        activeBlock={activeBlock}
        paragraphStyles={paragraphStyles}
        onUpdateActive={onUpdateActive}
      />
      <FontFamilySelect
        value={activeBlock?.fontFamily}
        onChange={(fontFamily) => onUpdateActive({ fontFamily })}
        compact
      />
      <select
        value={
          activeBlock?.fontSize ??
          (activeBlock?.type === "heading"
            ? headingFontSize(activeBlock.headingLevel ?? 1)
            : "14")
        }
        onChange={(event) => onUpdateActive({ fontSize: event.target.value })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.fontSize", { defaultValue: "Font size" })}
      >
        {["10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36"].map(
          (size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ),
        )}
      </select>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <ToolbarButton
        icon={Bold}
        label={t("documentEditor.bold")}
        onClick={() => onUpdateActive({ bold: !activeBlock?.bold })}
        active={activeBlock?.bold}
      />
      <ToolbarButton
        icon={Italic}
        label={t("documentEditor.italic")}
        onClick={() => onUpdateActive({ italic: !activeBlock?.italic })}
        active={activeBlock?.italic}
      />
      <ToolbarButton
        icon={Underline}
        label={t("documentEditor.underline", { defaultValue: "Underline" })}
        onClick={() => onUpdateActive({ underline: !activeBlock?.underline })}
        active={activeBlock?.underline}
      />
      <ToolbarButton
        icon={Link}
        label={t("documentEditor.linkParagraph", {
          defaultValue: "Link paragraph",
        })}
        onClick={onOpenLinkEditor}
        active={Boolean(activeBlock?.target)}
        disabled={
          !activeBlock || activeBlock.type === "table" || activeBlock.type === "image"
        }
      />
      <ToolbarButton
        icon={FileText}
        label="Normal style"
        onClick={onApplyNormalStyle}
        active={activeBlock?.type === "paragraph" && !activeBlock.listKind}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={Copy}
        label="Copy formatting"
        onClick={onCopyActiveFormatting}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={Eraser}
        label="Paste formatting"
        onClick={onPasteActiveFormatting}
        disabled={!canPasteFormatting || !isDocxTextBlock(activeBlock)}
      />
      {linkInputOpen && (
        <form
          className="flex min-w-56 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            onApplyLinkDraft();
          }}
        >
          <input
            value={linkDraft}
            onChange={(event) => onSetLinkDraft(event.target.value)}
            placeholder={t("documentEditor.linkUrl")}
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-md bg-[var(--accent)] px-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            {t("documentEditor.applyLink")}
          </button>
        </form>
      )}
      <label
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]",
          activeBlock?.bookmarkName && "border-[var(--accent)] text-[var(--accent)]",
          !isDocxTextBlock(activeBlock) && "opacity-40",
        )}
        title="Bookmark"
      >
        <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
        <input
          value={activeBlock?.bookmarkName ?? ""}
          onChange={(event) => {
            const bookmarkName = event.target.value.trim();
            onUpdateActive({
              bookmarkName: bookmarkName || undefined,
              bookmarkId: bookmarkName ? activeBlock?.bookmarkId : undefined,
            });
          }}
          placeholder="Bookmark"
          disabled={!isDocxTextBlock(activeBlock)}
          className="h-6 w-24 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>
      <ToolbarButton
        icon={Strikethrough}
        label="Strikethrough"
        onClick={() =>
          onUpdateActive({ strikethrough: !activeBlock?.strikethrough })
        }
        active={activeBlock?.strikethrough}
      />
      <ToolbarButton
        icon={Superscript}
        label="Superscript"
        onClick={() => onToggleActiveVerticalAlign("superscript")}
        active={activeBlock?.verticalAlign === "superscript"}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={Subscript}
        label="Subscript"
        onClick={() => onToggleActiveVerticalAlign("subscript")}
        active={activeBlock?.verticalAlign === "subscript"}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={Highlighter}
        label={t("documentEditor.highlight", { defaultValue: "Highlight" })}
        onClick={() =>
          onUpdateActive({ highlight: activeBlock?.highlight ? undefined : "#fef08a" })
        }
        active={Boolean(activeBlock?.highlight)}
      />
      <label
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title={t("documentEditor.textColor", { defaultValue: "Text color" })}
      >
        <Palette className="h-4 w-4" strokeWidth={1.75} />
        <input
          type="color"
          value={activeBlock?.color ?? "#111827"}
          onChange={(event) => onUpdateActive({ color: event.target.value })}
          className="sr-only"
        />
      </label>
    </>
  );
}
