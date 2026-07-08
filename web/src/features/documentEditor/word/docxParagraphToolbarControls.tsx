import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  FileText,
  IndentDecrease,
  IndentIncrease,
  List,
  ListOrdered,
  ListRestart,
  MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isDocxTextBlock,
  pointsToTwips,
  twipsToPoints,
} from "./docxEditorUtils";
import { ToolbarButton } from "../shared/shared";
import type { DocxEditorToolbarProps } from "./docxEditorToolbarTypes";

type DocxParagraphToolbarControlsProps = Pick<
  DocxEditorToolbarProps,
  | "activeBlock"
  | "onAdjustActiveIndent"
  | "onContinueActiveList"
  | "onInsertCommentReference"
  | "onInsertNoteReference"
  | "onToggleActiveList"
  | "onUpdateActive"
>;

export function DocxParagraphToolbarControls({
  activeBlock,
  onAdjustActiveIndent,
  onContinueActiveList,
  onInsertCommentReference,
  onInsertNoteReference,
  onToggleActiveList,
  onUpdateActive,
}: DocxParagraphToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
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
    </>
  );
}
