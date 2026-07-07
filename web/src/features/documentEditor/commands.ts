import type { DocumentEditorKind } from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

export type EditorCommandId =
  | "save"
  | "downloadPackage"
  | "undo"
  | "redo"
  | "find"
  | "replace"
  | "shortcuts"
  | "commandPalette"
  | "indent"
  | "outdent"
  | "lineComment"
  | "blockComment"
  | "selectLine"
  | "goToLine"
  | "togglePreview"
  | "duplicateLine"
  | "moveLineUp"
  | "moveLineDown"
  | "formatSource"
  | "minify"
  | "sortKeys"
  | "schema"
  | "toggleTree"
  | "toggleTable"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "link"
  | "normalStyle"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignJustify"
  | "alignTop"
  | "alignMiddle"
  | "alignBottom"
  | "distributeHorizontal"
  | "distributeVertical"
  | "group"
  | "ungroup"
  | "sendBackward"
  | "bringForward"
  | "bulletList"
  | "numberedList"
  | "pageBreak"
  | "taskList"
  | "blockquote"
  | "inlineCode"
  | "codeBlock"
  | "image"
  | "insertTable"
  | "outline"
  | "copyFormatting"
  | "pasteFormatting"
  | "footnote"
  | "endnote"
  | "newSlide"
  | "duplicate"
  | "delete"
  | "present"
  | "fillDown"
  | "fillRight"
  | "sortAscending"
  | "sortDescending"
  | "filter";

export interface EditorShortcut {
  key: string;
  display: string;
  primary?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface EditorCommandDefinition {
  id: EditorCommandId;
  labelKey: string;
  fallbackLabel: string;
  shortcuts: EditorShortcut[];
  handledByShell?: boolean;
}

export interface EditorCommandRequest {
  id: EditorCommandId;
  token: number;
}

const COMMON_COMMANDS: EditorCommandDefinition[] = [
  command("save", "Save", "Ctrl/Cmd+S", { key: "s", primary: true }, true),
  command(
    "downloadPackage",
    "Download package",
    "Ctrl/Cmd+Shift+S",
    { key: "s", primary: true, shift: true },
    true,
  ),
  command("undo", "Undo", "Ctrl/Cmd+Z", { key: "z", primary: true }, true),
  command("redo", "Redo", "Ctrl/Cmd+Y", { key: "y", primary: true }, true),
  command(
    "redo",
    "Redo",
    "Ctrl/Cmd+Shift+Z",
    { key: "z", primary: true, shift: true },
    true,
  ),
  command("find", "Find", "Ctrl/Cmd+F", { key: "f", primary: true }, true),
  command(
    "replace",
    "Replace",
    "Ctrl/Cmd+H",
    { key: "h", primary: true },
    true,
  ),
  command(
    "shortcuts",
    "Shortcuts",
    "Ctrl/Cmd+/",
    { key: "/", primary: true },
    true,
  ),
  command(
    "commandPalette",
    "Command palette",
    "Ctrl/Cmd+Shift+P",
    { key: "p", primary: true, shift: true },
    true,
  ),
];

const DOC_COMMANDS: EditorCommandDefinition[] = [
  command("bold", "Bold", "Ctrl/Cmd+B", { key: "b", primary: true }),
  command("italic", "Italic", "Ctrl/Cmd+I", { key: "i", primary: true }),
  command("underline", "Underline", "Ctrl/Cmd+U", { key: "u", primary: true }),
  command("link", "Link", "Ctrl/Cmd+K", { key: "k", primary: true }),
  command("normalStyle", "Normal style", "Ctrl/Cmd+Shift+N", {
    key: "n",
    primary: true,
    shift: true,
  }),
  command("strikethrough", "Strikethrough", "Ctrl/Cmd+Shift+X", {
    key: "x",
    primary: true,
    shift: true,
  }),
  command(
    "heading1",
    "Heading 1",
    "Ctrl/Cmd+Alt+1",
    { key: "1", primary: true, alt: true },
  ),
  command(
    "heading2",
    "Heading 2",
    "Ctrl/Cmd+Alt+2",
    { key: "2", primary: true, alt: true },
  ),
  command(
    "heading3",
    "Heading 3",
    "Ctrl/Cmd+Alt+3",
    { key: "3", primary: true, alt: true },
  ),
  command(
    "heading4",
    "Heading 4",
    "Ctrl/Cmd+Alt+4",
    { key: "4", primary: true, alt: true },
  ),
  command(
    "heading5",
    "Heading 5",
    "Ctrl/Cmd+Alt+5",
    { key: "5", primary: true, alt: true },
  ),
  command(
    "heading6",
    "Heading 6",
    "Ctrl/Cmd+Alt+6",
    { key: "6", primary: true, alt: true },
  ),
  command("alignLeft", "Align left", "Ctrl/Cmd+L", { key: "l", primary: true }),
  command("alignCenter", "Align center", "Ctrl/Cmd+E", {
    key: "e",
    primary: true,
  }),
  command("alignRight", "Align right", "Ctrl/Cmd+R", { key: "r", primary: true }),
  command("alignJustify", "Justify", "Ctrl/Cmd+J", { key: "j", primary: true }),
  command("bulletList", "Bulleted list", "Ctrl/Cmd+Shift+8", {
    key: "8",
    primary: true,
    shift: true,
  }),
  command("numberedList", "Numbered list", "Ctrl/Cmd+Shift+7", {
    key: "7",
    primary: true,
    shift: true,
  }),
  command("pageBreak", "Page break", "Ctrl/Cmd+Enter", {
    key: "Enter",
    primary: true,
  }),
  command("indent", "Indent", "Ctrl/Cmd+]", { key: "]", primary: true }),
  command("outdent", "Outdent", "Ctrl/Cmd+[", { key: "[", primary: true }),
  command("copyFormatting", "Copy formatting", "Ctrl/Cmd+Shift+C", {
    key: "c",
    primary: true,
    shift: true,
  }),
  command("pasteFormatting", "Paste formatting", "Ctrl/Cmd+Shift+V", {
    key: "v",
    primary: true,
    shift: true,
  }),
  command("footnote", "Footnote", "Ctrl/Cmd+Alt+F", {
    key: "f",
    primary: true,
    alt: true,
  }),
  command("endnote", "Endnote", "Ctrl/Cmd+Alt+E", {
    key: "e",
    primary: true,
    alt: true,
  }),
];

const MARKDOWN_COMMANDS: EditorCommandDefinition[] = [
  command("bold", "Bold", "Ctrl/Cmd+B", { key: "b", primary: true }),
  command("italic", "Italic", "Ctrl/Cmd+I", { key: "i", primary: true }),
  command("strikethrough", "Strikethrough", "Ctrl/Cmd+Shift+X", {
    key: "x",
    primary: true,
    shift: true,
  }),
  command("link", "Link", "Ctrl/Cmd+K", { key: "k", primary: true }),
  command("goToLine", "Go to line", "Ctrl/Cmd+G", { key: "g", primary: true }),
  command(
    "heading1",
    "Heading 1",
    "Ctrl/Cmd+Alt+1",
    { key: "1", primary: true, alt: true },
  ),
  command(
    "heading2",
    "Heading 2",
    "Ctrl/Cmd+Alt+2",
    { key: "2", primary: true, alt: true },
  ),
  command(
    "heading3",
    "Heading 3",
    "Ctrl/Cmd+Alt+3",
    { key: "3", primary: true, alt: true },
  ),
  command(
    "heading4",
    "Heading 4",
    "Ctrl/Cmd+Alt+4",
    { key: "4", primary: true, alt: true },
  ),
  command(
    "heading5",
    "Heading 5",
    "Ctrl/Cmd+Alt+5",
    { key: "5", primary: true, alt: true },
  ),
  command(
    "heading6",
    "Heading 6",
    "Ctrl/Cmd+Alt+6",
    { key: "6", primary: true, alt: true },
  ),
  command("togglePreview", "Toggle preview", "Ctrl/Cmd+Shift+V", {
    key: "v",
    primary: true,
    shift: true,
  }),
  command("bulletList", "Bulleted list", "Ctrl/Cmd+Shift+8", {
    key: "8",
    primary: true,
    shift: true,
  }),
  command("numberedList", "Numbered list", "Ctrl/Cmd+Shift+7", {
    key: "7",
    primary: true,
    shift: true,
  }),
  command("taskList", "Task list", "Ctrl/Cmd+Shift+9", {
    key: "9",
    primary: true,
    shift: true,
  }),
  command("blockquote", "Blockquote", "Ctrl/Cmd+Shift+.", {
    key: ".",
    primary: true,
    shift: true,
  }),
  command("inlineCode", "Inline code", "Ctrl/Cmd+E", {
    key: "e",
    primary: true,
  }),
  command("codeBlock", "Code block", "Ctrl/Cmd+Alt+C", {
    key: "c",
    primary: true,
    alt: true,
  }),
  command("image", "Image", "Ctrl/Cmd+Shift+I", {
    key: "i",
    primary: true,
    shift: true,
  }),
  command("insertTable", "Table", "Ctrl/Cmd+Alt+T", {
    key: "t",
    primary: true,
    alt: true,
  }),
  command("outline", "Outline", "Ctrl/Cmd+Alt+O", {
    key: "o",
    primary: true,
    alt: true,
  }),
];

const TEXT_COMMANDS: EditorCommandDefinition[] = [
  command("formatSource", "Format", "Ctrl/Cmd+Shift+F", {
    key: "f",
    primary: true,
    shift: true,
  }),
  command("minify", "Minify", "Ctrl/Cmd+Shift+M", {
    key: "m",
    primary: true,
    shift: true,
  }),
  command("sortKeys", "Sort keys", "Ctrl/Cmd+Alt+K", {
    key: "k",
    primary: true,
    alt: true,
  }),
  command("schema", "Schema", "Ctrl/Cmd+Alt+S", {
    key: "s",
    primary: true,
    alt: true,
  }),
  command("toggleTree", "Tree mode", "Ctrl/Cmd+Shift+T", {
    key: "t",
    primary: true,
    shift: true,
  }),
  command("toggleTable", "Table mode", "Ctrl/Cmd+Shift+B", {
    key: "b",
    primary: true,
    shift: true,
  }),
  command("indent", "Indent", "Tab", { key: "Tab" }),
  command("outdent", "Outdent", "Shift+Tab", { key: "Tab", shift: true }),
  command("lineComment", "Toggle line comment", "Ctrl/Cmd+/", {
    key: "/",
    primary: true,
  }),
  command("blockComment", "Toggle block comment", "Shift+Alt+A", {
    key: "a",
    shift: true,
    alt: true,
  }),
  command("selectLine", "Select line", "Ctrl/Cmd+L", { key: "l", primary: true }),
  command("goToLine", "Go to line", "Ctrl/Cmd+G", { key: "g", primary: true }),
  command("togglePreview", "Toggle preview", "Ctrl/Cmd+Shift+V", {
    key: "v",
    primary: true,
    shift: true,
  }),
  command("duplicateLine", "Duplicate line", "Shift+Alt+Down", {
    key: "ArrowDown",
    shift: true,
    alt: true,
  }),
  command("moveLineUp", "Move line up", "Alt+Up", { key: "ArrowUp", alt: true }),
  command("moveLineDown", "Move line down", "Alt+Down", {
    key: "ArrowDown",
    alt: true,
  }),
];

const SHEET_COMMANDS: EditorCommandDefinition[] = [
  command("fillDown", "Fill down", "Ctrl/Cmd+D", { key: "d", primary: true }),
  command("fillRight", "Fill right", "Ctrl/Cmd+R", { key: "r", primary: true }),
  command("sortAscending", "Sort ascending", "Alt+Shift+Up", {
    key: "ArrowUp",
    shift: true,
    alt: true,
  }),
  command("sortDescending", "Sort descending", "Alt+Shift+Down", {
    key: "ArrowDown",
    shift: true,
    alt: true,
  }),
  command(
    "filter",
    "Filter",
    "Ctrl/Cmd+Shift+L",
    { key: "l", primary: true, shift: true },
  ),
];

const PRESENTATION_COMMANDS: EditorCommandDefinition[] = [
  command("newSlide", "New slide", "Ctrl/Cmd+M", { key: "m", primary: true }),
  command(
    "duplicate",
    "Duplicate",
    "Ctrl/Cmd+D",
    { key: "d", primary: true },
  ),
  command("delete", "Delete selection", "Delete", { key: "Delete" }),
  command("sendBackward", "Send backward", "Ctrl/Cmd+Shift+[", {
    key: "[",
    primary: true,
    shift: true,
  }),
  command("bringForward", "Bring forward", "Ctrl/Cmd+Shift+]", {
    key: "]",
    primary: true,
    shift: true,
  }),
  command("group", "Group", "Ctrl/Cmd+G", {
    key: "g",
    primary: true,
  }),
  command("ungroup", "Ungroup", "Ctrl/Cmd+Shift+G", {
    key: "g",
    primary: true,
    shift: true,
  }),
  command("alignLeft", "Align left", "Alt+Shift+Left", {
    key: "ArrowLeft",
    shift: true,
    alt: true,
  }),
  command("alignCenter", "Align center", "Alt+Shift+C", {
    key: "c",
    shift: true,
    alt: true,
  }),
  command("alignRight", "Align right", "Alt+Shift+Right", {
    key: "ArrowRight",
    shift: true,
    alt: true,
  }),
  command("alignTop", "Align top", "Alt+Shift+Up", {
    key: "ArrowUp",
    shift: true,
    alt: true,
  }),
  command("alignMiddle", "Align middle", "Alt+Shift+M", {
    key: "m",
    shift: true,
    alt: true,
  }),
  command("alignBottom", "Align bottom", "Alt+Shift+Down", {
    key: "ArrowDown",
    shift: true,
    alt: true,
  }),
  command("distributeHorizontal", "Distribute horizontal", "Alt+Shift+H", {
    key: "h",
    shift: true,
    alt: true,
  }),
  command("distributeVertical", "Distribute vertical", "Alt+Shift+V", {
    key: "v",
    shift: true,
    alt: true,
  }),
  command("present", "Present", "F5", { key: "F5" }),
  command("insertTable", "Table", "Ctrl/Cmd+Alt+T", {
    key: "t",
    primary: true,
    alt: true,
  }),
];

export function editorCommandsForKind(
  kind: DocumentEditorKind,
  keymap: EditorKeymapEntry[] = [],
) {
  const commands = editorDefaultCommandsForKind(kind);
  return commands.map((command) => applyCommandKeymap(kind, command, keymap));
}

function editorDefaultCommandsForKind(kind: DocumentEditorKind) {
  if (kind === "xlsx" || kind === "csv" || kind === "tsv") {
    return [...COMMON_COMMANDS, ...SHEET_COMMANDS];
  }
  if (kind === "docx") {
    return [...COMMON_COMMANDS, ...DOC_COMMANDS];
  }
  if (kind === "markdown") return [...COMMON_COMMANDS, ...MARKDOWN_COMMANDS];
  if (kind === "text") {
    return [...COMMON_COMMANDS, ...TEXT_COMMANDS];
  }
  if (kind === "pptx") {
    return [...COMMON_COMMANDS, ...PRESENTATION_COMMANDS];
  }
  return COMMON_COMMANDS;
}

export function shellCommandsForKind(
  kind: DocumentEditorKind,
  keymap: EditorKeymapEntry[] = [],
) {
  return editorCommandsForKind(kind, keymap).filter((command) => command.handledByShell);
}

export function matchesEditorShortcut(
  event: KeyboardEvent,
  command: EditorCommandDefinition,
) {
  if (event.isComposing) return false;
  return command.shortcuts.some((shortcut) => {
    const primary = event.ctrlKey || event.metaKey;
    if (Boolean(shortcut.primary) !== primary) return false;
    if (Boolean(shortcut.shift) !== event.shiftKey) return false;
    if (Boolean(shortcut.alt) !== event.altKey) return false;
    return event.key.toLowerCase() === shortcut.key.toLowerCase();
  });
}

function applyCommandKeymap(
  kind: DocumentEditorKind,
  command: EditorCommandDefinition,
  keymap: EditorKeymapEntry[],
): EditorCommandDefinition {
  const override = keymap.find(
    (entry) => entry.editorKind === kind && entry.commandId === command.id,
  );
  if (!override) return command;
  return {
    ...command,
    shortcuts: [
      {
        key: override.shortcut.key,
        display: override.shortcut.display,
        primary: override.shortcut.primary,
        shift: override.shortcut.shift,
        alt: override.shortcut.alt,
      },
    ],
  };
}

function command(
  id: EditorCommandId,
  fallbackLabel: string,
  display: string,
  shortcut: Omit<EditorShortcut, "display">,
  handledByShell = false,
): EditorCommandDefinition {
  return {
    id,
    labelKey: `documentEditor.commands.${id}`,
    fallbackLabel,
    shortcuts: [{ ...shortcut, display }],
    handledByShell,
  };
}
