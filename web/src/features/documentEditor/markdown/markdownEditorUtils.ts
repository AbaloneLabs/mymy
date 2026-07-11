/**
 * Markdown editing combines source transformations, document metadata, and
 * lightweight navigation features. This facade keeps the public editor utility
 * API stable while the focused modules below own outline, table, reference,
 * and text-level behavior.
 */
export {
  addFrontmatterFieldBody,
  deleteFrontmatterFieldBody,
  formatFrontmatterField,
  frontmatterStructuralEditBlockReason,
  parseFrontmatter,
  parseFrontmatterFields,
  replaceFrontmatterBody,
  updateFrontmatterFieldBody,
} from "./markdownFrontmatter";
export type {
  FrontmatterField,
  MarkdownFrontmatter,
  MarkdownFrontmatterFormat,
} from "./markdownFrontmatter";
export {
  insertOrUpdateMarkdownToc,
  markdownHeadingAnchors,
  markdownOutline,
  markdownOutlineFromAst,
} from "./markdownOutlineUtils";
export { markdownReferences } from "./markdownReferenceUtils";
export {
  markdownTableAtLine,
  markdownTables,
  patchMarkdownTableAlignment,
  patchMarkdownTableCell,
  replaceMarkdownTable,
} from "./markdownTableUtils";
export {
  buildMarkdownSearchRegex,
  countMarkdownSearchMatches,
  hasTrailingTextNewline,
  indentMarkdownLine,
  insertFootnoteReference,
  isMarkdownHeadingKey,
  isMarkdownUrl,
  lineForOffset,
  markdownStats,
  nextMarkdownFootnoteId,
  nextMarkdownSearchRange,
  offsetForLine,
  outdentMarkdownLine,
} from "./markdownTextUtils";
export type {
  MarkdownHeading,
  MarkdownHeadingAnchor,
  MarkdownHeadingLevel,
  MarkdownReference,
  MarkdownTableAlignment,
  MarkdownTableCellSpan,
  MarkdownTableModel,
} from "./markdownTypes";

export function modeButtonClass(active: boolean) {
  return [
    "rounded-md border px-2 py-1 text-xs",
    active
      ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
      : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
  ].join(" ");
}

export function markdownTextButtonClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";
}
