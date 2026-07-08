import {
  allocateDocxBlockId,
  isDocxTextBlock,
  textOffsetWithin,
  textSelectionOffsetsWithin,
} from "./docxEditorUtils";
import {
  docxMergeRuns,
  docxRunsText,
  replaceDocxRunRange,
  splitDocxRunsAroundRange,
} from "./docxTextRuns";
import type { DocxBlock, DocxRun } from "../shared/models";

interface DocxPasteParagraph {
  runs: DocxRun[];
  type?: "paragraph" | "heading";
  headingLevel?: number;
}

interface DocxPasteContext {
  blocks: DocxBlock[];
  blockIndex: number;
  element: HTMLElement;
  clipboardData: Pick<DataTransfer, "getData">;
}

interface DocxPasteResult {
  blocks: DocxBlock[];
  nextActiveId?: string;
}

const DOCX_HTML_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/**
 * Rich DOCX paste is deliberately model-first: the browser never mutates the
 * contenteditable DOM directly. Clipboard HTML/plaintext is converted into the
 * same run model used for saved DOCX paragraphs, then the active block range is
 * replaced. This keeps pasted formatting, undo history, and OOXML output on a
 * single representation instead of reconciling arbitrary pasted DOM afterward.
 */
export function buildDocxPasteResult({
  blocks,
  blockIndex,
  element,
  clipboardData,
}: DocxPasteContext): DocxPasteResult | null {
  const block = blocks[blockIndex];
  if (!isDocxTextBlock(block)) return null;
  const paragraphs = docxClipboardParagraphs(clipboardData);
  if (paragraphs.length === 0) return null;
  const selection = textSelectionOffsetsWithin(element);
  const offset = textOffsetWithin(element);
  const start = selection?.start ?? offset;
  const end = selection?.end ?? offset;
  if (paragraphs.length === 1) {
    const nextBlock = replaceDocxRunRange(block, start, end, paragraphs[0].runs);
    if (!nextBlock) return null;
    return {
      blocks: blocks.map((item, index) => (index === blockIndex ? nextBlock : item)),
      nextActiveId: nextBlock.id,
    };
  }
  const replacement = docxMultiParagraphPasteBlocks(
    blocks,
    block,
    start,
    end,
    paragraphs,
  );
  return {
    blocks: [
      ...blocks.slice(0, blockIndex),
      ...replacement,
      ...blocks.slice(blockIndex + 1),
    ],
    nextActiveId: replacement.at(-1)?.id,
  };
}

function docxClipboardParagraphs(clipboardData: Pick<DataTransfer, "getData">) {
  const html = clipboardData.getData("text/html").trim();
  if (html) {
    const paragraphs = docxParagraphsFromHtml(html);
    if (paragraphs.length > 0) return paragraphs;
  }
  const text = clipboardData.getData("text/plain");
  return docxParagraphsFromPlainText(text);
}

function docxMultiParagraphPasteBlocks(
  blocks: DocxBlock[],
  block: DocxBlock,
  start: number,
  end: number,
  paragraphs: DocxPasteParagraph[],
) {
  const { before, after } = splitDocxRunsAroundRange(block, start, end);
  const usedIds = new Set(blocks.map((item) => item.id));
  const lastIndex = paragraphs.length - 1;
  return paragraphs.map((paragraph, paragraphIndex) => {
    const runs =
      paragraphIndex === 0
        ? docxMergeRuns([...before, ...paragraph.runs])
        : paragraphIndex === lastIndex
          ? docxMergeRuns([...paragraph.runs, ...after])
          : docxMergeRuns(paragraph.runs);
    const text = docxRunsText(runs);
    if (paragraphIndex === 0) {
      return {
        ...block,
        text,
        runs: runs.length > 0 ? runs : undefined,
      };
    }
    return {
      ...newDocxPastedParagraph(block, paragraph, usedIds),
      text,
      runs: runs.length > 0 ? runs : undefined,
    };
  });
}

function newDocxPastedParagraph(
  source: DocxBlock,
  paragraph: DocxPasteParagraph,
  usedIds: Set<string>,
): DocxBlock {
  const isHeading = paragraph.type === "heading";
  return {
    id: allocateDocxBlockId(usedIds, "p"),
    type: isHeading ? "heading" : "paragraph",
    text: "",
    headingLevel: isHeading ? paragraph.headingLevel ?? 1 : undefined,
    paragraphStyleId: isHeading ? undefined : source.paragraphStyleId,
    paragraphStyleName: isHeading ? undefined : source.paragraphStyleName,
    fontFamily: source.fontFamily,
    fontSize: isHeading ? headingSize(paragraph.headingLevel ?? 1) : source.fontSize,
    align: source.align,
    listLevel: source.listLevel,
    listNumberingId: source.listNumberingId,
    listStart: undefined,
    indentLeft: source.indentLeft,
    spacingBefore: source.spacingBefore,
    spacingAfter: source.spacingAfter,
    lineSpacing: source.lineSpacing,
    listKind: source.listKind,
  };
}

function docxParagraphsFromPlainText(text: string) {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((part) => ({
      runs: part ? [{ text: part }] : [],
    }));
}

function docxParagraphsFromHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const paragraphs: DocxPasteParagraph[] = [];
  const active: DocxPasteParagraph = { runs: [] };
  for (const node of Array.from(document.body.childNodes)) {
    appendHtmlNodeToParagraphs(node, {}, active, paragraphs);
  }
  pushParagraph(active, paragraphs);
  return paragraphs.filter((paragraph) => docxRunsText(paragraph.runs).length > 0);
}

function appendHtmlNodeToParagraphs(
  node: ChildNode,
  style: Partial<DocxRun>,
  active: DocxPasteParagraph,
  paragraphs: DocxPasteParagraph[],
) {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(active, { ...style, text: node.textContent ?? "" });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "BR") {
    appendRun(active, { ...style, text: "\n" });
    return;
  }
  const block = htmlParagraphMetadata(node);
  if (block && docxRunsText(active.runs).length > 0) {
    pushParagraph(active, paragraphs);
  }
  const nextStyle = { ...style, ...htmlInlineStyle(node) };
  const target = block ? { ...active, ...block, runs: active.runs } : active;
  for (const child of Array.from(node.childNodes)) {
    appendHtmlNodeToParagraphs(child, nextStyle, target, paragraphs);
  }
  if (block) {
    active.runs = target.runs;
    active.type = target.type;
    active.headingLevel = target.headingLevel;
    pushParagraph(active, paragraphs);
  }
}

function htmlParagraphMetadata(element: HTMLElement): Partial<DocxPasteParagraph> | null {
  if (!DOCX_HTML_BLOCK_TAGS.has(element.tagName)) return null;
  const heading = /^H([1-6])$/.exec(element.tagName);
  if (heading) {
    return {
      type: "heading",
      headingLevel: Number(heading[1]),
    };
  }
  return { type: "paragraph", headingLevel: undefined };
}

function htmlInlineStyle(element: HTMLElement): Partial<DocxRun> {
  const style: Partial<DocxRun> = {};
  const tagName = element.tagName;
  const css = element.style;
  if (tagName === "B" || tagName === "STRONG" || boldCss(css.fontWeight)) {
    style.bold = true;
  }
  if (tagName === "I" || tagName === "EM" || css.fontStyle === "italic") {
    style.italic = true;
  }
  const decoration = css.textDecorationLine || css.textDecoration;
  if (tagName === "U" || decoration.includes("underline")) {
    style.underline = true;
  }
  if (tagName === "S" || tagName === "STRIKE" || decoration.includes("line-through")) {
    style.strikethrough = true;
  }
  if (tagName === "SUP" || css.verticalAlign === "super") {
    style.verticalAlign = "superscript";
  }
  if (tagName === "SUB" || css.verticalAlign === "sub") {
    style.verticalAlign = "subscript";
  }
  if (css.fontFamily) {
    style.fontFamily = css.fontFamily.replace(/["']/g, "").split(",")[0]?.trim();
  }
  if (css.fontSize) {
    style.fontSize = cssSizeToPixels(css.fontSize);
  }
  const color = cssColorToHex(css.color);
  if (color) style.color = color;
  const highlight = cssColorToHex(css.backgroundColor);
  if (highlight) style.highlight = highlight;
  return style;
}

function pushParagraph(
  paragraph: DocxPasteParagraph,
  paragraphs: DocxPasteParagraph[],
) {
  paragraphs.push({
    type: paragraph.type,
    headingLevel: paragraph.headingLevel,
    runs: docxMergeRuns(paragraph.runs),
  });
  paragraph.runs = [];
  paragraph.type = undefined;
  paragraph.headingLevel = undefined;
}

function appendRun(paragraph: DocxPasteParagraph, run: DocxRun) {
  if (run.text.length === 0) return;
  paragraph.runs = docxMergeRuns([...paragraph.runs, run]);
}

function boldCss(value: string) {
  if (value === "bold" || value === "bolder") return true;
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

function cssSizeToPixels(value: string) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (value.endsWith("pt")) return String(Math.round(numeric * (4 / 3)));
  if (value.endsWith("em") || value.endsWith("rem")) {
    return String(Math.round(numeric * 16));
  }
  return String(Math.round(numeric));
}

function cssColorToHex(value: string) {
  const color = value.trim();
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return undefined;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    return hex[1].length === 3
      ? `#${hex[1]
          .split("")
          .map((item) => `${item}${item}`)
          .join("")
          .toUpperCase()}`
      : `#${hex[1].toUpperCase()}`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (!rgb) return undefined;
  const parts = rgb[1]
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return `#${parts
    .map((part) =>
      Math.max(0, Math.min(255, Math.round(part)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function headingSize(level: number) {
  return (
    {
      1: "32",
      2: "28",
      3: "24",
      4: "20",
      5: "18",
      6: "16",
    } as Record<number, string>
  )[level] ?? "14";
}
