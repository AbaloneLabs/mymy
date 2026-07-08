import type { RefObject } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bookmark,
  Bold,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  FileText,
  Heading1,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListTree,
  ListOrdered,
  ListRestart,
  Palette,
  Plus,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Underline,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  DOCX_PAGE_PRESETS,
  docxPagePresetValue,
  headingFontSize,
  isDocxTextBlock,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRowHeights,
  pointsToTwips,
  tableColumnCount,
  twipsToPoints,
} from "./docxEditorUtils";
import { FontFamilySelect, ToolbarButton } from "./shared";
import { DocxMarginInput } from "./docxEditorBlocks";
import type { DocxBlock, DocxPageSettings, DocxStyle } from "./models";

type DocxInsertableBlockType = Exclude<
  DocxBlock["type"],
  "image" | "pageBreak" | "sectionBreak"
>;

export function DocxEditorToolbar({
  activeBlock,
  page,
  linkInputOpen,
  linkDraft,
  canPasteFormatting,
  hasDocumentParts,
  textPartsOpen,
  outlineOpen,
  imageInputRef,
  paragraphStyles,
  onUpdateActive,
  onOpenLinkEditor,
  onApplyLinkDraft,
  onSetLinkDraft,
  onApplyNormalStyle,
  onCopyActiveFormatting,
  onPasteActiveFormatting,
  onToggleActiveVerticalAlign,
  onAdjustActiveIndent,
  onToggleActiveList,
  onContinueActiveList,
  onInsertCommentReference,
  onInsertNoteReference,
  onUpdatePagePreset,
  onUpdatePageOrientation,
  onUpdatePage,
  onToggleTextPartsOpen,
  onToggleOutlineOpen,
  onMoveActiveBlock,
  onDeleteActiveBlock,
  onInsertImageFile,
  onAddBlock,
  onInsertPageBreak,
  onInsertSectionBreak,
}: {
  activeBlock: DocxBlock | undefined;
  page: DocxPageSettings | undefined;
  linkInputOpen: boolean;
  linkDraft: string;
  canPasteFormatting: boolean;
  hasDocumentParts: boolean;
  textPartsOpen: boolean;
  outlineOpen: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  paragraphStyles: DocxStyle[];
  onUpdateActive: (patch: Partial<DocxBlock>) => void;
  onOpenLinkEditor: () => void;
  onApplyLinkDraft: () => void;
  onSetLinkDraft: (value: string) => void;
  onApplyNormalStyle: () => void;
  onCopyActiveFormatting: () => void;
  onPasteActiveFormatting: () => void;
  onToggleActiveVerticalAlign: (
    verticalAlign: NonNullable<DocxBlock["verticalAlign"]>,
  ) => void;
  onAdjustActiveIndent: (delta: number) => void;
  onToggleActiveList: (listKind: "bullet" | "number") => void;
  onContinueActiveList: () => void;
  onInsertCommentReference: () => void;
  onInsertNoteReference: (kind: "footnote" | "endnote") => void;
  onUpdatePagePreset: (value: string) => void;
  onUpdatePageOrientation: (orientation: "portrait" | "landscape") => void;
  onUpdatePage: (patch: Partial<DocxPageSettings>) => void;
  onToggleTextPartsOpen: () => void;
  onToggleOutlineOpen: () => void;
  onMoveActiveBlock: (direction: -1 | 1) => void;
  onDeleteActiveBlock: () => void;
  onInsertImageFile: (file: File) => void;
  onAddBlock: (type: DocxInsertableBlockType) => void;
  onInsertPageBreak: () => void;
  onInsertSectionBreak: () => void;
}) {
  const { t } = useTranslation();

  function updateBlockType(value: string) {
    const styleMatch = /^style:(.+)$/.exec(value);
    if (styleMatch) {
      const style = paragraphStyles.find((item) => item.id === styleMatch[1]);
      if (!style) return;
      const headingLevel = headingLevelFromStyleId(style.id);
      onUpdateActive({
        type: headingLevel ? "heading" : "paragraph",
        headingLevel,
        paragraphStyleId: style.id,
        paragraphStyleName: style.name,
        fontFamily: undefined,
        fontSize: undefined,
        bold: undefined,
        italic: undefined,
        underline: undefined,
        strikethrough: undefined,
        color: undefined,
        highlight: undefined,
      });
      return;
    }
    if (value === "image") return;
    if (value === "pageBreak") {
      onUpdateActive({
        type: "pageBreak",
        text: "",
        headingLevel: undefined,
        rows: undefined,
        tableColumnWidths: undefined,
        tableRowHeights: undefined,
        tableStyle: undefined,
        tableBorderColor: undefined,
        tableBorderSize: undefined,
        tableCellBackground: undefined,
        tableHeaderRow: undefined,
        tableHeaderBackground: undefined,
        tableCellVerticalAlign: undefined,
        listKind: undefined,
        target: undefined,
        relationshipId: undefined,
      });
      return;
    }
    if (value === "sectionBreak") {
      onUpdateActive({
        type: "sectionBreak",
        text: "",
        headingLevel: undefined,
        rows: undefined,
        tableColumnWidths: undefined,
        tableRowHeights: undefined,
        tableStyle: undefined,
        tableBorderColor: undefined,
        tableBorderSize: undefined,
        tableCellBackground: undefined,
        tableHeaderRow: undefined,
        tableHeaderBackground: undefined,
        tableCellVerticalAlign: undefined,
        listKind: undefined,
        target: undefined,
        relationshipId: undefined,
        breakKind: activeBlock?.breakKind ?? "nextPage",
      });
      return;
    }
    const headingMatch = /^heading:(\d)$/.exec(value);
    const type = headingMatch ? "heading" : (value as DocxBlock["type"]);
    const headingLevel = headingMatch ? Number(headingMatch[1]) : undefined;
    const tableRows = activeBlock?.rows ?? [
      ["", ""],
      ["", ""],
    ];
    onUpdateActive({
      type,
      headingLevel,
      paragraphStyleId: type === "heading" ? `Heading${headingLevel ?? 1}` : undefined,
      paragraphStyleName: undefined,
      text: type === "table" ? "" : activeBlock?.text ?? "",
      rows: type === "table" ? tableRows : undefined,
      tableColumnWidths:
        type === "table"
          ? normalizeDocxTableColumnWidths(
              activeBlock?.tableColumnWidths,
              tableColumnCount(tableRows),
            )
          : undefined,
      tableRowHeights:
        type === "table"
          ? normalizeDocxTableRowHeights(
              activeBlock?.tableRowHeights,
              tableRows.length,
            )
          : undefined,
      tableStyle: type === "table" ? activeBlock?.tableStyle : undefined,
      tableBorderColor: type === "table" ? activeBlock?.tableBorderColor : undefined,
      tableBorderSize: type === "table" ? activeBlock?.tableBorderSize : undefined,
      tableCellBackground:
        type === "table" ? activeBlock?.tableCellBackground : undefined,
      tableHeaderRow: type === "table" ? activeBlock?.tableHeaderRow : undefined,
      tableHeaderBackground:
        type === "table" ? activeBlock?.tableHeaderBackground : undefined,
      tableCellVerticalAlign:
        type === "table" ? activeBlock?.tableCellVerticalAlign : undefined,
      fontSize:
        type === "heading"
          ? headingFontSize(headingLevel ?? 1)
          : activeBlock?.fontSize ?? "14",
    });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <select
        value={
          activeBlock?.paragraphStyleId && activeBlock.type !== "heading"
            ? `style:${activeBlock.paragraphStyleId}`
            : activeBlock?.type === "heading"
            ? `heading:${activeBlock.headingLevel ?? 1}`
            : activeBlock?.type ?? "paragraph"
        }
        onChange={(event) => updateBlockType(event.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.style", { defaultValue: "Style" })}
      >
        <option value="paragraph">Normal text</option>
        {Array.from({ length: 6 }, (_, index) => index + 1).map((level) => (
          <option key={level} value={`heading:${level}`}>
            Heading {level}
          </option>
        ))}
        <option value="table">Table</option>
        <option value="pageBreak">Page break</option>
        <option value="sectionBreak">Section break</option>
        {activeBlock?.type === "image" && <option value="image">Image</option>}
        {documentParagraphStyles(paragraphStyles).length > 0 && (
          <optgroup label="Document styles">
            {documentParagraphStyles(paragraphStyles).map((style) => (
              <option key={style.id} value={`style:${style.id}`}>
                {style.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {activeBlock?.type === "sectionBreak" && (
        <select
          value={activeBlock.breakKind ?? "nextPage"}
          onChange={(event) =>
            onUpdateActive({
              breakKind: event.target.value as NonNullable<DocxBlock["breakKind"]>,
            })
          }
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Section break kind"
        >
          <option value="nextPage">Next page</option>
          <option value="continuous">Continuous</option>
          <option value="evenPage">Even page</option>
          <option value="oddPage">Odd page</option>
        </select>
      )}
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
        label={t("documentEditor.link")}
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
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <ToolbarButton
        icon={AlignLeft}
        label="Left"
        onClick={() => onUpdateActive({ align: "left" })}
        active={!activeBlock?.align || activeBlock.align === "left"}
      />
      <ToolbarButton
        icon={AlignCenter}
        label="Center"
        onClick={() => onUpdateActive({ align: "center" })}
        active={activeBlock?.align === "center"}
      />
      <ToolbarButton
        icon={AlignRight}
        label="Right"
        onClick={() => onUpdateActive({ align: "right" })}
        active={activeBlock?.align === "right"}
      />
      <ToolbarButton
        icon={AlignJustify}
        label="Justify"
        onClick={() => onUpdateActive({ align: "justify" })}
        active={activeBlock?.align === "justify"}
      />
      <ToolbarButton
        icon={IndentDecrease}
        label={t("documentEditor.outdent", { defaultValue: "Outdent" })}
        onClick={() => onAdjustActiveIndent(-360)}
        disabled={!activeBlock?.indentLeft}
      />
      <ToolbarButton
        icon={IndentIncrease}
        label={t("documentEditor.indent", { defaultValue: "Indent" })}
        onClick={() => onAdjustActiveIndent(360)}
      />
      <ToolbarButton
        icon={List}
        label={t("documentEditor.bullets")}
        onClick={() => onToggleActiveList("bullet")}
        active={activeBlock?.listKind === "bullet"}
        disabled={!activeBlock || activeBlock.type === "table"}
      />
      <ToolbarButton
        icon={ListOrdered}
        label={t("documentEditor.numbered")}
        onClick={() => onToggleActiveList("number")}
        active={activeBlock?.listKind === "number"}
        disabled={!activeBlock || activeBlock.type === "table"}
      />
      {activeBlock?.listKind && (
        <>
          <select
            value={activeBlock.listLevel ?? 0}
            onChange={(event) =>
              onUpdateActive({ listLevel: Number(event.target.value) })
            }
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="List level"
          >
            {Array.from({ length: 9 }, (_, index) => (
              <option key={index} value={index}>
                Level {index + 1}
              </option>
            ))}
          </select>
          {activeBlock.listKind === "number" && (
            <>
              <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
                Start
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={activeBlock.listStart ?? ""}
                  onChange={(event) =>
                    onUpdateActive({
                      listStart: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                  className="w-14 bg-transparent text-xs text-[var(--text)] outline-none"
                />
              </label>
              <ToolbarButton
                icon={ListRestart}
                label="Continue list"
                onClick={onContinueActiveList}
                disabled={!activeBlock}
              />
            </>
          )}
        </>
      )}
      <select
        value={activeBlock?.lineSpacing ?? 276}
        onChange={(event) => onUpdateActive({ lineSpacing: Number(event.target.value) })}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.lineSpacing", { defaultValue: "Line spacing" })}
      >
        <option value={240}>1.0</option>
        <option value={276}>1.15</option>
        <option value={360}>1.5</option>
        <option value={480}>2.0</option>
      </select>
      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
        Before
        <input
          type="number"
          min={0}
          max={72}
          value={twipsToPoints(activeBlock?.spacingBefore ?? 0)}
          onChange={(event) =>
            onUpdateActive({
              spacingBefore: pointsToTwips(Number(event.target.value)),
            })
          }
          className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
        />
      </label>
      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
        After
        <input
          type="number"
          min={0}
          max={72}
          value={twipsToPoints(activeBlock?.spacingAfter ?? 0)}
          onChange={(event) =>
            onUpdateActive({
              spacingAfter: pointsToTwips(Number(event.target.value)),
            })
          }
          className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
        />
      </label>
      <ToolbarButton
        icon={FileText}
        label="Page break before"
        onClick={() =>
          onUpdateActive({ pageBreakBefore: !activeBlock?.pageBreakBefore })
        }
        active={activeBlock?.pageBreakBefore}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={FileText}
        label="Keep with next"
        onClick={() => onUpdateActive({ keepWithNext: !activeBlock?.keepWithNext })}
        active={activeBlock?.keepWithNext}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={FileText}
        label="Keep lines together"
        onClick={() =>
          onUpdateActive({
            keepLinesTogether: !activeBlock?.keepLinesTogether,
          })
        }
        active={activeBlock?.keepLinesTogether}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={MessageSquare}
        label="Comment"
        onClick={onInsertCommentReference}
        active={Boolean(activeBlock?.commentId)}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={FileText}
        label="Footnote"
        onClick={() => onInsertNoteReference("footnote")}
        active={Boolean(activeBlock?.footnoteId)}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <ToolbarButton
        icon={FileText}
        label="Endnote"
        onClick={() => onInsertNoteReference("endnote")}
        active={Boolean(activeBlock?.endnoteId)}
        disabled={!isDocxTextBlock(activeBlock)}
      />
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <select
        value={docxPagePresetValue(page)}
        onChange={(event) => onUpdatePagePreset(event.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.pageSize", {
          defaultValue: "Page size",
        })}
      >
        <option value="custom">Custom</option>
        {DOCX_PAGE_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>
      <select
        value={page?.orientation ?? "portrait"}
        onChange={(event) =>
          onUpdatePageOrientation(
            event.target.value === "landscape" ? "landscape" : "portrait",
          )
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.pageOrientation", {
          defaultValue: "Page orientation",
        })}
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <select
        value={page?.columnCount ?? 1}
        onChange={(event) =>
          onUpdatePage({
            columnCount: Number(event.target.value),
            columnEqualWidth: true,
          })
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title="Columns"
      >
        {Array.from({ length: 6 }, (_, index) => index + 1).map((count) => (
          <option key={count} value={count}>
            {count} column{count === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
        Gap
        <input
          type="number"
          min={0}
          max={144}
          value={twipsToPoints(page?.columnSpacing ?? 720)}
          onChange={(event) =>
            onUpdatePage({
              columnSpacing: pointsToTwips(Number(event.target.value)),
              columnEqualWidth: true,
            })
          }
          className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
        />
      </label>
      <DocxMarginInput
        label="Top"
        value={page?.marginTop}
        onChange={(marginTop) => onUpdatePage({ marginTop })}
      />
      <DocxMarginInput
        label="Right"
        value={page?.marginRight}
        onChange={(marginRight) => onUpdatePage({ marginRight })}
      />
      <DocxMarginInput
        label="Bottom"
        value={page?.marginBottom}
        onChange={(marginBottom) => onUpdatePage({ marginBottom })}
      />
      <DocxMarginInput
        label="Left"
        value={page?.marginLeft}
        onChange={(marginLeft) => onUpdatePage({ marginLeft })}
      />
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <ToolbarButton
        icon={ListTree}
        label="Outline"
        onClick={onToggleOutlineOpen}
        active={outlineOpen}
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
    </div>
  );
}

function documentParagraphStyles(styles: DocxStyle[]) {
  return styles.filter(
    (style) =>
      style.type === "paragraph" &&
      !headingLevelFromStyleId(style.id) &&
      style.id !== "Normal",
  );
}

function headingLevelFromStyleId(styleId: string) {
  const normalized = styleId
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const level = Number(normalized.replace(/^heading/, ""));
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : undefined;
}
