import type { Dispatch, SetStateAction } from "react";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";
import type { XlsxModel, XlsxSheet } from "../shared/models";

export type SpreadsheetCellActionParams = {
  activeCell: CellPosition | null;
  columnCount: number;
  commitXlsxModel: (next: XlsxModel) => void;
  displaySheet: XlsxSheet | undefined;
  model: XlsxModel;
  selectedRanges: NormalizedCellRange[];
  selectionRange: NormalizedCellRange | null;
  setActiveCell: Dispatch<SetStateAction<CellPosition | null>>;
  setExtraSelectionRanges: Dispatch<SetStateAction<NormalizedCellRange[]>>;
  setSelectionAnchor: Dispatch<SetStateAction<CellPosition | null>>;
  setSelectionEnd: Dispatch<SetStateAction<CellPosition | null>>;
  sheet: XlsxSheet | undefined;
};
