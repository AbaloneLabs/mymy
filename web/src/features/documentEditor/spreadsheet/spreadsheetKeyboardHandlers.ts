import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";
import type { CellPosition } from "./spreadsheetGeometry";
import {
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
} from "./spreadsheetPresentation";

interface SpreadsheetCellKeyDownOptions {
  activeCellStyle?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
  applyCellStyle: (style: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  }) => void;
  columnCount: number;
  copySelection: () => Promise<void>;
  displayRowLimit: number;
  fillDown: () => void;
  fillRight: () => void;
  focusCell: (row: number, column: number) => void;
  selectCell: (position: CellPosition, extend?: boolean, additive?: boolean) => void;
  setShowFormulas: Dispatch<SetStateAction<boolean>>;
  updateCell: (row: number, column: number, value: string) => void;
}

export function handleSpreadsheetCellKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  row: number,
  column: number,
  options: SpreadsheetCellKeyDownOptions,
) {
  const primary = event.ctrlKey || event.metaKey;
  if (primary && event.key.toLowerCase() === "c") {
    event.preventDefault();
    void options.copySelection();
    return;
  }
  if (primary && event.key.toLowerCase() === "d") {
    event.preventDefault();
    options.fillDown();
    return;
  }
  if (primary && event.key.toLowerCase() === "r") {
    event.preventDefault();
    options.fillRight();
    return;
  }
  if (primary && event.key.toLowerCase() === "b") {
    event.preventDefault();
    options.applyCellStyle({ bold: !options.activeCellStyle?.bold });
    return;
  }
  if (primary && event.key.toLowerCase() === "i") {
    event.preventDefault();
    options.applyCellStyle({ italic: !options.activeCellStyle?.italic });
    return;
  }
  if (primary && event.key.toLowerCase() === "u") {
    event.preventDefault();
    options.applyCellStyle({ underline: !options.activeCellStyle?.underline });
    return;
  }
  if (primary && event.key === "`") {
    event.preventDefault();
    options.setShowFormulas((current) => !current);
    return;
  }
  if (event.key === "ArrowDown" && event.shiftKey) {
    event.preventDefault();
    options.selectCell(
      { row: Math.min(row + 1, options.displayRowLimit - 1), column },
      true,
    );
    return;
  }
  if (event.key === "ArrowUp" && event.shiftKey) {
    event.preventDefault();
    options.selectCell({ row: Math.max(row - 1, 0), column }, true);
    return;
  }
  if (event.key === "ArrowRight" && event.shiftKey) {
    event.preventDefault();
    options.selectCell(
      { row, column: Math.min(column + 1, options.columnCount - 1) },
      true,
    );
    return;
  }
  if (event.key === "ArrowLeft" && event.shiftKey) {
    event.preventDefault();
    options.selectCell({ row, column: Math.max(column - 1, 0) }, true);
    return;
  }
  if (primary && event.key === ";") {
    event.preventDefault();
    options.updateCell(
      row,
      column,
      event.shiftKey ? spreadsheetTimeStamp() : spreadsheetDateStamp(),
    );
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    options.focusCell(
      event.shiftKey
        ? Math.max(row - 1, 0)
        : Math.min(row + 1, options.displayRowLimit - 1),
      column,
    );
  } else if (event.key === "Tab") {
    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const nextColumn = column + direction;
    if (nextColumn >= 0 && nextColumn < options.columnCount) {
      options.focusCell(row, nextColumn);
    } else if (!event.shiftKey && row < options.displayRowLimit - 1) {
      options.focusCell(row + 1, 0);
    } else if (event.shiftKey && row > 0) {
      options.focusCell(row - 1, options.columnCount - 1);
    }
  }
}
