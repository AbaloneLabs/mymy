import type { EditorCommandRequest } from "../shared/commands";

interface PptxEditorCommandHandlers {
  addSlide: () => void;
  duplicateSlide: () => void;
  duplicateSelectedObjects: () => void;
  deleteSelectedObjects: () => void;
  moveActiveObjectLayer: (direction: -1 | 1) => void;
  groupSelectedObjects: () => void;
  ungroupSelectedObjects: () => void;
  alignActiveObject: (
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => void;
  distributeSelectedObjects: (axis: "horizontal" | "vertical") => void;
  present: () => void;
  addTable: () => void;
  hasObjectSelection: boolean;
  hasActiveObject: boolean;
}

export function runPptxEditorCommand(
  commandId: EditorCommandRequest["id"],
  handlers: PptxEditorCommandHandlers,
) {
  switch (commandId) {
    case "newSlide":
      handlers.addSlide();
      return true;
    case "duplicate":
      if (handlers.hasObjectSelection || handlers.hasActiveObject) {
        handlers.duplicateSelectedObjects();
      } else {
        handlers.duplicateSlide();
      }
      return true;
    case "delete":
      handlers.deleteSelectedObjects();
      return true;
    case "sendBackward":
      handlers.moveActiveObjectLayer(-1);
      return true;
    case "bringForward":
      handlers.moveActiveObjectLayer(1);
      return true;
    case "group":
      handlers.groupSelectedObjects();
      return true;
    case "ungroup":
      handlers.ungroupSelectedObjects();
      return true;
    case "alignLeft":
      handlers.alignActiveObject("left");
      return true;
    case "alignCenter":
      handlers.alignActiveObject("center");
      return true;
    case "alignRight":
      handlers.alignActiveObject("right");
      return true;
    case "alignTop":
      handlers.alignActiveObject("top");
      return true;
    case "alignMiddle":
      handlers.alignActiveObject("middle");
      return true;
    case "alignBottom":
      handlers.alignActiveObject("bottom");
      return true;
    case "distributeHorizontal":
      handlers.distributeSelectedObjects("horizontal");
      return true;
    case "distributeVertical":
      handlers.distributeSelectedObjects("vertical");
      return true;
    case "present":
      handlers.present();
      return true;
    case "insertTable":
      handlers.addTable();
      return true;
    default:
      return false;
  }
}
