import { useTranslation } from "react-i18next";
import {
  headingFontSize,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRowHeights,
  tableColumnCount,
} from "./docxEditorUtils";
import type { DocxBlock, DocxStyle } from "../shared/models";

type DocxBlockTypeSelectProps = {
  activeBlock: DocxBlock | undefined;
  paragraphStyles: DocxStyle[];
  onUpdateActive: (patch: Partial<DocxBlock>) => void;
};

export function DocxBlockTypeSelect({
  activeBlock,
  paragraphStyles,
  onUpdateActive,
}: DocxBlockTypeSelectProps) {
  const { t } = useTranslation();

  function updateBlockType(value: string) {
    const styleMatch = /^style:(.+)$/.exec(value);
    if (styleMatch) {
      const style = paragraphStyles.find((item) => item.id === styleMatch[1]);
      if (!style) return;
      const headingLevel = headingLevelFromStyleId(style.id);
      onUpdateActive({
        type: headingLevel ? "heading" : "paragraph",
        headingLevel,
        paragraphStyleId: style.id,
        paragraphStyleName: style.name,
        fontFamily: undefined,
        fontSize: undefined,
        bold: undefined,
        italic: undefined,
        underline: undefined,
        strikethrough: undefined,
        color: undefined,
        highlight: undefined,
      });
      return;
    }
    if (value === "image") return;
    if (value === "pageBreak") {
      onUpdateActive({
        type: "pageBreak",
        text: "",
        headingLevel: undefined,
        rows: undefined,
        tableColumnWidths: undefined,
        tableRowHeights: undefined,
        tableStyle: undefined,
        tableBorderColor: undefined,
        tableBorderSize: undefined,
        tableCellBackground: undefined,
        tableHeaderRow: undefined,
        tableHeaderBackground: undefined,
        tableCellVerticalAlign: undefined,
        listKind: undefined,
        target: undefined,
        relationshipId: undefined,
      });
      return;
    }
    if (value === "sectionBreak") {
      onUpdateActive({
        type: "sectionBreak",
        text: "",
        headingLevel: undefined,
        rows: undefined,
        tableColumnWidths: undefined,
        tableRowHeights: undefined,
        tableStyle: undefined,
        tableBorderColor: undefined,
        tableBorderSize: undefined,
        tableCellBackground: undefined,
        tableHeaderRow: undefined,
        tableHeaderBackground: undefined,
        tableCellVerticalAlign: undefined,
        listKind: undefined,
        target: undefined,
        relationshipId: undefined,
        breakKind: activeBlock?.breakKind ?? "nextPage",
      });
      return;
    }
    const headingMatch = /^heading:(\d)$/.exec(value);
    const type = headingMatch ? "heading" : (value as DocxBlock["type"]);
    const headingLevel = headingMatch ? Number(headingMatch[1]) : undefined;
    const tableRows = activeBlock?.rows ?? [
      ["", ""],
      ["", ""],
    ];
    onUpdateActive({
      type,
      headingLevel,
      paragraphStyleId: type === "heading" ? `Heading${headingLevel ?? 1}` : undefined,
      paragraphStyleName: undefined,
      text: type === "table" ? "" : activeBlock?.text ?? "",
      rows: type === "table" ? tableRows : undefined,
      tableColumnWidths:
        type === "table"
          ? normalizeDocxTableColumnWidths(
              activeBlock?.tableColumnWidths,
              tableColumnCount(tableRows),
            )
          : undefined,
      tableRowHeights:
        type === "table"
          ? normalizeDocxTableRowHeights(
              activeBlock?.tableRowHeights,
              tableRows.length,
            )
          : undefined,
      tableStyle: type === "table" ? activeBlock?.tableStyle : undefined,
      tableBorderColor: type === "table" ? activeBlock?.tableBorderColor : undefined,
      tableBorderSize: type === "table" ? activeBlock?.tableBorderSize : undefined,
      tableCellBackground:
        type === "table" ? activeBlock?.tableCellBackground : undefined,
      tableHeaderRow: type === "table" ? activeBlock?.tableHeaderRow : undefined,
      tableHeaderBackground:
        type === "table" ? activeBlock?.tableHeaderBackground : undefined,
      tableCellVerticalAlign:
        type === "table" ? activeBlock?.tableCellVerticalAlign : undefined,
      fontSize:
        type === "heading"
          ? headingFontSize(headingLevel ?? 1)
          : activeBlock?.fontSize ?? "14",
    });
  }

  return (
    <>
      <select
        value={
          activeBlock?.paragraphStyleId && activeBlock.type !== "heading"
            ? `style:${activeBlock.paragraphStyleId}`
            : activeBlock?.type === "heading"
              ? `heading:${activeBlock.headingLevel ?? 1}`
              : activeBlock?.type ?? "paragraph"
        }
        onChange={(event) => updateBlockType(event.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.style", { defaultValue: "Style" })}
      >
        <option value="paragraph">Normal text</option>
        {Array.from({ length: 6 }, (_, index) => index + 1).map((level) => (
          <option key={level} value={`heading:${level}`}>
            Heading {level}
          </option>
        ))}
        <option value="table">Table</option>
        <option value="pageBreak">Page break</option>
        <option value="sectionBreak">Section break</option>
        {activeBlock?.type === "image" && <option value="image">Image</option>}
        {documentParagraphStyles(paragraphStyles).length > 0 && (
          <optgroup label="Document styles">
            {documentParagraphStyles(paragraphStyles).map((style) => (
              <option key={style.id} value={`style:${style.id}`}>
                {style.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {activeBlock?.type === "sectionBreak" && (
        <select
          value={activeBlock.breakKind ?? "nextPage"}
          onChange={(event) =>
            onUpdateActive({
              breakKind: event.target.value as NonNullable<DocxBlock["breakKind"]>,
            })
          }
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Section break kind"
        >
          <option value="nextPage">Next page</option>
          <option value="continuous">Continuous</option>
          <option value="evenPage">Even page</option>
          <option value="oddPage">Odd page</option>
        </select>
      )}
    </>
  );
}

function documentParagraphStyles(styles: DocxStyle[]) {
  return styles.filter(
    (style) =>
      style.type === "paragraph" &&
      !headingLevelFromStyleId(style.id) &&
      style.id !== "Normal",
  );
}

function headingLevelFromStyleId(styleId: string) {
  const normalized = styleId
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const level = Number(normalized.replace(/^heading/, ""));
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : undefined;
}
