import type { EditorCommandRequest } from "./commands";

interface SpreadsheetEditorCommandHandlers {
  fillDown: () => void;
  fillRight: () => void;
  sortRowsByActiveColumn: (direction: "asc" | "desc") => void;
  clearAutoFilter: () => void;
  setAutoFilterFromSelection: () => void;
  hasAutoFilter: boolean;
}

export function runSpreadsheetEditorCommand(
  commandId: EditorCommandRequest["id"],
  handlers: SpreadsheetEditorCommandHandlers,
) {
  switch (commandId) {
    case "fillDown":
      handlers.fillDown();
      return true;
    case "fillRight":
      handlers.fillRight();
      return true;
    case "sortAscending":
      handlers.sortRowsByActiveColumn("asc");
      return true;
    case "sortDescending":
      handlers.sortRowsByActiveColumn("desc");
      return true;
    case "filter":
      if (handlers.hasAutoFilter) handlers.clearAutoFilter();
      else handlers.setAutoFilterFromSelection();
      return true;
    default:
      return false;
  }
}
