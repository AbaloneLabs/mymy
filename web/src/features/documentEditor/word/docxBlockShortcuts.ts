import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { headingFontSize } from "./docxEditorUtils";
import type { DocxBlock } from "../shared/models";

interface DocxBlockShortcutOptions {
  copyBlockFormatting: (index: number) => void;
  insertCommentReference: (blockIndex?: number) => void;
  insertNoteReference: (
    kind: "footnote" | "endnote",
    blockIndex?: number,
  ) => void;
  normalFontSizeForBlock: (index: number) => string;
  pasteBlockFormatting: (index: number) => void;
  toggleBlockList: (index: number, listKind: "bullet" | "number") => void;
  toggleInlineBooleanOrBlock: (
    index: number,
    key: "bold" | "italic" | "underline" | "strikethrough",
  ) => void;
  updateBlock: (index: number, patch: Partial<DocxBlock>) => void;
}

export function handleDocxBlockShortcut(
  event: ReactKeyboardEvent<HTMLDivElement>,
  index: number,
  options: DocxBlockShortcutOptions,
) {
  const primary = event.ctrlKey || event.metaKey;
  if (!primary) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    options.toggleInlineBooleanOrBlock(index, "bold");
  } else if (key === "i") {
    event.preventDefault();
    options.toggleInlineBooleanOrBlock(index, "italic");
  } else if (key === "u") {
    event.preventDefault();
    options.toggleInlineBooleanOrBlock(index, "underline");
  } else if (event.shiftKey && key === "x") {
    event.preventDefault();
    options.toggleInlineBooleanOrBlock(index, "strikethrough");
  } else if (event.altKey && /^[1-6]$/.test(key)) {
    event.preventDefault();
    const headingLevel = Number(key);
    options.updateBlock(index, {
      type: "heading",
      headingLevel,
      fontSize: headingFontSize(headingLevel),
    });
  } else if (event.altKey && key === "0") {
    event.preventDefault();
    options.updateBlock(index, {
      type: "paragraph",
      headingLevel: undefined,
      fontSize: "14",
    });
  } else if (event.shiftKey && key === "n") {
    event.preventDefault();
    options.updateBlock(index, {
      type: "paragraph",
      headingLevel: undefined,
      fontSize: options.normalFontSizeForBlock(index),
      listKind: undefined,
    });
  } else if (event.shiftKey && key === "c") {
    event.preventDefault();
    options.copyBlockFormatting(index);
  } else if (event.shiftKey && key === "v") {
    event.preventDefault();
    options.pasteBlockFormatting(index);
  } else if (event.altKey && key === "f") {
    event.preventDefault();
    options.insertNoteReference("footnote", index);
  } else if (event.altKey && key === "e") {
    event.preventDefault();
    options.insertNoteReference("endnote", index);
  } else if (event.altKey && key === "m") {
    event.preventDefault();
    options.insertCommentReference(index);
  } else if (key === "l") {
    event.preventDefault();
    options.updateBlock(index, { align: "left" });
  } else if (key === "e") {
    event.preventDefault();
    options.updateBlock(index, { align: "center" });
  } else if (key === "r") {
    event.preventDefault();
    options.updateBlock(index, { align: "right" });
  } else if (key === "j") {
    event.preventDefault();
    options.updateBlock(index, { align: "justify" });
  } else if (event.shiftKey && (key === "*" || event.code === "Digit8")) {
    event.preventDefault();
    options.toggleBlockList(index, "bullet");
  } else if (event.shiftKey && (key === "&" || event.code === "Digit7")) {
    event.preventDefault();
    options.toggleBlockList(index, "number");
  }
}
