import { DocxDocumentToolbarControls } from "./docxDocumentToolbarControls";
import { DocxPageToolbarControls } from "./docxPageToolbarControls";
import { DocxParagraphToolbarControls } from "./docxParagraphToolbarControls";
import { DocxTextToolbarControls } from "./docxTextToolbarControls";
import type { DocxEditorToolbarProps } from "./docxEditorToolbarTypes";

export function DocxEditorToolbar(props: DocxEditorToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <DocxTextToolbarControls
        activeBlock={props.activeBlock}
        canPasteFormatting={props.canPasteFormatting}
        linkDraft={props.linkDraft}
        linkInputOpen={props.linkInputOpen}
        onApplyLinkDraft={props.onApplyLinkDraft}
        onApplyNormalStyle={props.onApplyNormalStyle}
        onCopyActiveFormatting={props.onCopyActiveFormatting}
        onOpenLinkEditor={props.onOpenLinkEditor}
        onPasteActiveFormatting={props.onPasteActiveFormatting}
        onSetLinkDraft={props.onSetLinkDraft}
        onToggleActiveVerticalAlign={props.onToggleActiveVerticalAlign}
        onUpdateActive={props.onUpdateActive}
        paragraphStyles={props.paragraphStyles}
      />
      <DocxParagraphToolbarControls
        activeBlock={props.activeBlock}
        onAdjustActiveIndent={props.onAdjustActiveIndent}
        onContinueActiveList={props.onContinueActiveList}
        onInsertCommentReference={props.onInsertCommentReference}
        onInsertNoteReference={props.onInsertNoteReference}
        onToggleActiveList={props.onToggleActiveList}
        onUpdateActive={props.onUpdateActive}
      />
      <DocxPageToolbarControls
        onUpdatePage={props.onUpdatePage}
        onUpdatePageOrientation={props.onUpdatePageOrientation}
        onUpdatePagePreset={props.onUpdatePagePreset}
        page={props.page}
      />
      <DocxDocumentToolbarControls
        hasDocumentParts={props.hasDocumentParts}
        imageInputRef={props.imageInputRef}
        onAddBlock={props.onAddBlock}
        onDeleteActiveBlock={props.onDeleteActiveBlock}
        onInsertImageFile={props.onInsertImageFile}
        onInsertPageBreak={props.onInsertPageBreak}
        onInsertSectionBreak={props.onInsertSectionBreak}
        onMoveActiveBlock={props.onMoveActiveBlock}
        onToggleOutlineOpen={props.onToggleOutlineOpen}
        onToggleStylesOpen={props.onToggleStylesOpen}
        onToggleTextPartsOpen={props.onToggleTextPartsOpen}
        outlineOpen={props.outlineOpen}
        stylesOpen={props.stylesOpen}
        textPartsOpen={props.textPartsOpen}
      />
    </div>
  );
}

export type {
  DocxEditorToolbarProps,
  DocxInsertableBlockType,
} from "./docxEditorToolbarTypes";
