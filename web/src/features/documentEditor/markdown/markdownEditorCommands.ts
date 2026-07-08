import type { EditorCommandRequest } from "../shared/commands";
import type { MarkdownHeadingLevel } from "./markdownEditorUtils";
import type { MarkdownSidePanelKind } from "./markdownSidePanel";

type MarkdownCommandActions = {
  applyBlockquote: () => void;
  applyBulletList: () => void;
  applyHeading: (level: MarkdownHeadingLevel) => void;
  applyInlineCode: () => void;
  applyNumberedList: () => void;
  insertCodeBlock: () => void;
  insertMarkdownTable: () => void;
  insertTableOfContents: () => void;
  insertTaskList: () => void;
  setGoToLineDraft: (value: string) => void;
  setGoToLineOpen: (value: boolean) => void;
  setImageInputOpen: (value: boolean) => void;
  setLinkInputOpen: (value: boolean) => void;
  setSidePanel: (updater: (current: MarkdownSidePanelKind | null) => MarkdownSidePanelKind | null) => void;
  togglePreview: () => void;
  wrapSourceSelection: (before: string, after?: string) => void;
};

export function runMarkdownEditorCommand(
  commandId: EditorCommandRequest["id"],
  cursorLine: number,
  actions: MarkdownCommandActions,
) {
  if (commandId === "bold") {
    actions.wrapSourceSelection("**");
  } else if (commandId === "italic") {
    actions.wrapSourceSelection("*");
  } else if (commandId === "strikethrough") {
    actions.wrapSourceSelection("~~");
  } else if (commandId === "link") {
    actions.setLinkInputOpen(true);
  } else if (commandId === "heading1") {
    actions.applyHeading(1);
  } else if (commandId === "heading2") {
    actions.applyHeading(2);
  } else if (commandId === "heading3") {
    actions.applyHeading(3);
  } else if (commandId === "heading4") {
    actions.applyHeading(4);
  } else if (commandId === "heading5") {
    actions.applyHeading(5);
  } else if (commandId === "heading6") {
    actions.applyHeading(6);
  } else if (commandId === "togglePreview") {
    actions.togglePreview();
  } else if (commandId === "bulletList") {
    actions.applyBulletList();
  } else if (commandId === "numberedList") {
    actions.applyNumberedList();
  } else if (commandId === "taskList") {
    actions.insertTaskList();
  } else if (commandId === "blockquote") {
    actions.applyBlockquote();
  } else if (commandId === "inlineCode") {
    actions.applyInlineCode();
  } else if (commandId === "codeBlock") {
    actions.insertCodeBlock();
  } else if (commandId === "image") {
    actions.setImageInputOpen(true);
  } else if (commandId === "insertTable") {
    actions.insertMarkdownTable();
  } else if (commandId === "tableOfContents") {
    actions.insertTableOfContents();
  } else if (commandId === "outline") {
    actions.setSidePanel((current) => (current === "outline" ? null : "outline"));
  } else if (commandId === "goToLine") {
    actions.setGoToLineDraft(String(cursorLine));
    actions.setGoToLineOpen(true);
  } else {
    return false;
  }
  return true;
}
