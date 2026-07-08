import type { DocxBlock } from "../shared/models";
import { sectionBreakLabel } from "./docxEditorUtils";

export type DocxOutlineItem = {
  id: string;
  index: number;
  kind: string;
  label: string;
  level: number;
};

export function buildDocxOutlineItems(blocks: DocxBlock[]): DocxOutlineItem[] {
  return blocks
    .map((block, index): DocxOutlineItem | null => {
      if (block.type === "heading") {
        return {
          id: block.id,
          index,
          label:
            block.bookmarkName ??
            (block.text.trim() || `Heading ${block.headingLevel ?? 1}`),
          kind: `Heading ${block.headingLevel ?? 1}`,
          level: block.headingLevel ?? 1,
        };
      }
      if (block.bookmarkName) {
        return {
          id: block.id,
          index,
          label: block.bookmarkName,
          kind: "Bookmark",
          level: 1,
        };
      }
      if (block.type === "table") {
        return { id: block.id, index, label: "Table", kind: "Table", level: 1 };
      }
      if (block.type === "image") {
        return {
          id: block.id,
          index,
          label: block.altText?.trim() || "Image",
          kind: "Image",
          level: 1,
        };
      }
      if (block.type === "pageBreak" || block.type === "sectionBreak") {
        return {
          id: block.id,
          index,
          label:
            block.type === "pageBreak"
              ? "Page break"
              : `Section break (${sectionBreakLabel(block.breakKind)})`,
          kind: block.type === "pageBreak" ? "Page" : "Section",
          level: 1,
        };
      }
      return null;
    })
    .filter((item): item is DocxOutlineItem => Boolean(item));
}
