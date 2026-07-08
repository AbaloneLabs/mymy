import type { DocxBlock } from "../shared/models";
import {
  addDocxTableColumn,
  addDocxTableRow,
  deleteDocxTableColumn,
  deleteDocxTableRow,
  duplicateDocxTableColumn,
  duplicateDocxTableRow,
  insertDocxTableColumn,
  insertDocxTableRow,
  mergeDocxTableCellDown,
  mergeDocxTableCellRight,
  moveDocxTableColumn,
  moveDocxTableRow,
  pasteDocxTableCells,
  resizeDocxTableColumn,
  resizeDocxTableRow,
  splitDocxTableCell,
  updateDocxTableCell,
} from "./docxTableOperations";

type DocxTableActionOptions = {
  blocks: DocxBlock[];
  updateBlock: (index: number, patch: Partial<DocxBlock>) => void;
};

export function createDocxTableActions({
  blocks,
  updateBlock,
}: DocxTableActionOptions) {
  function updateTableCell(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, updateDocxTableCell(block, rowIndex, columnIndex, value));
  }

  function addTableRow(blockIndex: number) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, addDocxTableRow(block));
  }

  function insertTableRow(
    blockIndex: number,
    rowIndex: number,
    position: "above" | "below",
  ) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, insertDocxTableRow(block, rowIndex, position));
  }

  function addTableColumn(blockIndex: number) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, addDocxTableColumn(block));
  }

  function insertTableColumn(
    blockIndex: number,
    columnIndex: number,
    position: "left" | "right",
  ) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, insertDocxTableColumn(block, columnIndex, position));
  }

  function duplicateTableRow(blockIndex: number, rowIndex: number) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, duplicateDocxTableRow(block, rowIndex));
  }

  function duplicateTableColumn(blockIndex: number, columnIndex: number) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, duplicateDocxTableColumn(block, columnIndex));
  }

  function moveTableRow(blockIndex: number, rowIndex: number, direction: -1 | 1) {
    const block = blocks[blockIndex];
    const patch = moveDocxTableRow(block, rowIndex, direction);
    if (patch) updateBlock(blockIndex, patch);
  }

  function moveTableColumn(
    blockIndex: number,
    columnIndex: number,
    direction: -1 | 1,
  ) {
    const block = blocks[blockIndex];
    const patch = moveDocxTableColumn(block, columnIndex, direction);
    if (patch) updateBlock(blockIndex, patch);
  }

  function deleteTableRow(blockIndex: number, rowIndex: number) {
    const block = blocks[blockIndex];
    const patch = deleteDocxTableRow(block, rowIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function deleteTableColumn(blockIndex: number, columnIndex: number) {
    const block = blocks[blockIndex];
    const patch = deleteDocxTableColumn(block, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function clearTableCell(blockIndex: number, rowIndex: number, columnIndex: number) {
    updateTableCell(blockIndex, rowIndex, columnIndex, "");
  }

  function mergeTableCellRight(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = mergeDocxTableCellRight(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function mergeTableCellDown(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = mergeDocxTableCellDown(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function splitTableCell(
    blockIndex: number,
    rowIndex: number,
    columnIndex: number,
  ) {
    const block = blocks[blockIndex];
    if (block?.type !== "table") return;
    const patch = splitDocxTableCell(block, rowIndex, columnIndex);
    if (patch) updateBlock(blockIndex, patch);
  }

  function pasteTableCells(
    blockIndex: number,
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    const block = blocks[blockIndex];
    const patch = pasteDocxTableCells(block, startRow, startColumn, matrix);
    if (patch) updateBlock(blockIndex, patch);
  }

  function updateTableColumnWidth(
    blockIndex: number,
    columnIndex: number,
    width: number,
  ) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, resizeDocxTableColumn(block, columnIndex, width));
  }

  function updateTableRowHeight(
    blockIndex: number,
    rowIndex: number,
    height: number,
  ) {
    const block = blocks[blockIndex];
    updateBlock(blockIndex, resizeDocxTableRow(block, rowIndex, height));
  }

  function updateTableStyle(blockIndex: number, patch: Partial<DocxBlock>) {
    const block = blocks[blockIndex];
    if (block?.type !== "table") return;
    updateBlock(blockIndex, patch);
  }

  return {
    addTableColumn,
    addTableRow,
    clearTableCell,
    deleteTableColumn,
    deleteTableRow,
    duplicateTableColumn,
    duplicateTableRow,
    insertTableColumn,
    insertTableRow,
    mergeTableCellDown,
    mergeTableCellRight,
    moveTableColumn,
    moveTableRow,
    pasteTableCells,
    splitTableCell,
    updateTableCell,
    updateTableColumnWidth,
    updateTableRowHeight,
    updateTableStyle,
  };
}
