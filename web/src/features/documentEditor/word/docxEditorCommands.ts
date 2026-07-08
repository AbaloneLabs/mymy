import type { EditorCommandRequest } from "../shared/commands";
import { headingFontSize } from "./docxEditorUtils";
import type { DocxBlock } from "../shared/models";

type DocxEditorCommandActions = {
  adjustActiveIndent: (delta: number) => void;
  applyNormalStyle: () => void;
  copyActiveFormatting: () => void;
  insertCommentReference: () => void;
  insertNoteReference: (kind: "footnote" | "endnote") => void;
  insertPageBreak: () => void;
  openLinkEditor: () => void;
  pasteActiveFormatting: () => void;
  toggleBlockList: (index: number, listKind: "bullet" | "number") => void;
  toggleInlineBooleanOrBlock: (
    index: number,
    key: "bold" | "italic" | "underline" | "strikethrough",
  ) => void;
  updateActive: (patch: Partial<DocxBlock>) => void;
};

export function runDocxEditorCommand(
  commandId: EditorCommandRequest["id"],
  activeBlock: DocxBlock | undefined,
  blocks: DocxBlock[],
  actions: DocxEditorCommandActions,
) {
  if (!activeBlock) return false;
  const activeIndex = blocks.findIndex((block) => block.id === activeBlock.id);
  if (commandId === "bold") {
    if (activeIndex >= 0) actions.toggleInlineBooleanOrBlock(activeIndex, "bold");
  } else if (commandId === "italic") {
    if (activeIndex >= 0) actions.toggleInlineBooleanOrBlock(activeIndex, "italic");
  } else if (commandId === "underline") {
    if (activeIndex >= 0) actions.toggleInlineBooleanOrBlock(activeIndex, "underline");
  } else if (commandId === "link") {
    actions.openLinkEditor();
  } else if (commandId === "normalStyle") {
    actions.applyNormalStyle();
  } else if (commandId === "strikethrough") {
    if (activeIndex >= 0) {
      actions.toggleInlineBooleanOrBlock(activeIndex, "strikethrough");
    }
  } else if (commandId === "heading1") {
    actions.updateActive({ type: "heading", headingLevel: 1, fontSize: headingFontSize(1) });
  } else if (commandId === "heading2") {
    actions.updateActive({ type: "heading", headingLevel: 2, fontSize: headingFontSize(2) });
  } else if (commandId === "heading3") {
    actions.updateActive({ type: "heading", headingLevel: 3, fontSize: headingFontSize(3) });
  } else if (commandId === "heading4") {
    actions.updateActive({ type: "heading", headingLevel: 4, fontSize: headingFontSize(4) });
  } else if (commandId === "heading5") {
    actions.updateActive({ type: "heading", headingLevel: 5, fontSize: headingFontSize(5) });
  } else if (commandId === "heading6") {
    actions.updateActive({ type: "heading", headingLevel: 6, fontSize: headingFontSize(6) });
  } else if (commandId === "alignLeft") {
    actions.updateActive({ align: "left" });
  } else if (commandId === "alignCenter") {
    actions.updateActive({ align: "center" });
  } else if (commandId === "alignRight") {
    actions.updateActive({ align: "right" });
  } else if (commandId === "alignJustify") {
    actions.updateActive({ align: "justify" });
  } else if (commandId === "bulletList") {
    if (activeIndex >= 0) actions.toggleBlockList(activeIndex, "bullet");
  } else if (commandId === "numberedList") {
    if (activeIndex >= 0) actions.toggleBlockList(activeIndex, "number");
  } else if (commandId === "pageBreak") {
    actions.insertPageBreak();
  } else if (commandId === "indent") {
    actions.adjustActiveIndent(360);
  } else if (commandId === "outdent") {
    actions.adjustActiveIndent(-360);
  } else if (commandId === "copyFormatting") {
    actions.copyActiveFormatting();
  } else if (commandId === "pasteFormatting") {
    actions.pasteActiveFormatting();
  } else if (commandId === "footnote") {
    actions.insertNoteReference("footnote");
  } else if (commandId === "endnote") {
    actions.insertNoteReference("endnote");
  } else if (commandId === "comment") {
    actions.insertCommentReference();
  } else {
    return false;
  }
  return true;
}
