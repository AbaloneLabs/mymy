import {
  replaceMarkdownTable,
} from "./markdownEditorUtils";
import type {
  MarkdownTableAlignment,
  MarkdownTableModel,
} from "./markdownEditorUtils";

type MarkdownTableActionParams = {
  activeTable: MarkdownTableModel | null;
  content: string;
  updateContent: (content: string) => void;
};

export function createMarkdownTableActions({
  activeTable,
  content,
  updateContent,
}: MarkdownTableActionParams) {
  function updateMarkdownTable(nextTable: MarkdownTableModel) {
    if (!activeTable) return;
    updateContent(replaceMarkdownTable(content, activeTable, nextTable));
  }

  function updateMarkdownTableHeader(columnIndex: number, value: string) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      headers: activeTable.headers.map((header, index) =>
        index === columnIndex ? value : header,
      ),
    });
  }

  function updateMarkdownTableAlignment(
    columnIndex: number,
    alignment: MarkdownTableAlignment,
  ) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      alignments: activeTable.alignments.map((item, index) =>
        index === columnIndex ? alignment : item,
      ),
    });
  }

  function updateMarkdownTableCell(
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: activeTable.rows.map((row, index) =>
        index === rowIndex
          ? row.map((cell, currentColumn) =>
              currentColumn === columnIndex ? value : cell,
            )
          : row,
      ),
    });
  }

  function addMarkdownTableRow(afterRowIndex?: number) {
    if (!activeTable) return;
    const insertAt =
      afterRowIndex === undefined
        ? activeTable.rows.length
        : Math.min(activeTable.rows.length, afterRowIndex + 1);
    const rows = activeTable.rows.map((row) => [...row]);
    rows.splice(insertAt, 0, Array(activeTable.headers.length).fill(""));
    updateMarkdownTable({ ...activeTable, rows });
  }

  function duplicateMarkdownTableRow(rowIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: [
        ...activeTable.rows.slice(0, rowIndex + 1),
        [...(activeTable.rows[rowIndex] ?? [])],
        ...activeTable.rows.slice(rowIndex + 1),
      ],
    });
  }

  function moveMarkdownTableRow(rowIndex: number, direction: -1 | 1) {
    if (!activeTable) return;
    const nextIndex = rowIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeTable.rows.length) return;
    const rows = activeTable.rows.map((row) => [...row]);
    const [moved] = rows.splice(rowIndex, 1);
    rows.splice(nextIndex, 0, moved);
    updateMarkdownTable({ ...activeTable, rows });
  }

  function deleteMarkdownTableRow(rowIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      rows: activeTable.rows.filter((_, index) => index !== rowIndex),
    });
  }

  function addMarkdownTableColumn(afterColumnIndex?: number) {
    if (!activeTable) return;
    const insertAt =
      afterColumnIndex === undefined
        ? activeTable.headers.length
        : Math.min(activeTable.headers.length, afterColumnIndex + 1);
    const headers = [...activeTable.headers];
    const alignments = [...activeTable.alignments];
    headers.splice(insertAt, 0, "");
    alignments.splice(insertAt, 0, "default");
    updateMarkdownTable({
      ...activeTable,
      headers,
      alignments,
      rows: activeTable.rows.map((row) => {
        const next = [...row];
        next.splice(insertAt, 0, "");
        return next;
      }),
    });
  }

  function duplicateMarkdownTableColumn(columnIndex: number) {
    if (!activeTable) return;
    updateMarkdownTable({
      ...activeTable,
      headers: [
        ...activeTable.headers.slice(0, columnIndex + 1),
        activeTable.headers[columnIndex] ?? "",
        ...activeTable.headers.slice(columnIndex + 1),
      ],
      alignments: [
        ...activeTable.alignments.slice(0, columnIndex + 1),
        activeTable.alignments[columnIndex] ?? "default",
        ...activeTable.alignments.slice(columnIndex + 1),
      ],
      rows: activeTable.rows.map((row) => [
        ...row.slice(0, columnIndex + 1),
        row[columnIndex] ?? "",
        ...row.slice(columnIndex + 1),
      ]),
    });
  }

  function moveMarkdownTableColumn(columnIndex: number, direction: -1 | 1) {
    if (!activeTable) return;
    const nextIndex = columnIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeTable.headers.length) return;
    const move = <T,>(items: T[]) => {
      const next = [...items];
      const [moved] = next.splice(columnIndex, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    };
    updateMarkdownTable({
      ...activeTable,
      headers: move(activeTable.headers),
      alignments: move(activeTable.alignments),
      rows: activeTable.rows.map((row) => move(row)),
    });
  }

  function deleteMarkdownTableColumn(columnIndex: number) {
    if (!activeTable || activeTable.headers.length <= 1) return;
    updateMarkdownTable({
      ...activeTable,
      headers: activeTable.headers.filter((_, index) => index !== columnIndex),
      alignments: activeTable.alignments.filter((_, index) => index !== columnIndex),
      rows: activeTable.rows.map((row) =>
        row.filter((_, index) => index !== columnIndex),
      ),
    });
  }

  return {
    addMarkdownTableColumn,
    addMarkdownTableRow,
    deleteMarkdownTableColumn,
    deleteMarkdownTableRow,
    duplicateMarkdownTableColumn,
    duplicateMarkdownTableRow,
    moveMarkdownTableColumn,
    moveMarkdownTableRow,
    updateMarkdownTableAlignment,
    updateMarkdownTableCell,
    updateMarkdownTableHeader,
  };
}
