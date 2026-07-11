import type { RefObject } from "react";
import type { DocxBlock, DocxPageSettings, DocxStyle } from "../shared/models";

export type DocxInsertableBlockType = Exclude<
  DocxBlock["type"],
  "image" | "pageBreak" | "sectionBreak"
>;

export interface DocxEditorToolbarProps {
  activeBlock: DocxBlock | undefined;
  page: DocxPageSettings | undefined;
  pageDraftDirty: boolean;
  pageScopeLabel: string;
  linkInputOpen: boolean;
  linkDraft: string;
  canPasteFormatting: boolean;
  hasDocumentParts: boolean;
  textPartsOpen: boolean;
  outlineOpen: boolean;
  stylesOpen: boolean;
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
  onApplyPageDraft: () => void;
  onCancelPageDraft: () => void;
  onToggleTextPartsOpen: () => void;
  onToggleOutlineOpen: () => void;
  onToggleStylesOpen: () => void;
  onMoveActiveBlock: (direction: -1 | 1) => void;
  onDeleteActiveBlock: () => void;
  onInsertImageFile: (file: File) => void;
  onAddBlock: (type: DocxInsertableBlockType) => void;
  onInsertPageBreak: () => void;
  onInsertSectionBreak: () => void;
}
