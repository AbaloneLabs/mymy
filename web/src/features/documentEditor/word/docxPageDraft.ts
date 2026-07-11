import type { DocxModel, DocxPageSettings } from "../shared/models";

export interface DocxPageDraftTarget {
  id: string;
  label: string;
  page: DocxPageSettings;
  breakBlockId?: string;
}

/**
 * A section break owns the settings for the content before it; the final body
 * sectPr owns the last section. Resolving that ownership explicitly keeps a
 * page toolbar edit from normalizing every section just because the UI used to
 * expose a single document-level value.
 */
export function resolveDocxPageDraftTarget(
  model: DocxModel,
  activeBlockId: string | null | undefined,
): DocxPageDraftTarget {
  const activeIndex = Math.max(
    0,
    model.blocks.findIndex((block) => block.id === activeBlockId),
  );
  const breakIndexes = model.blocks
    .map((block, index) => (block.type === "sectionBreak" ? index : -1))
    .filter((index) => index >= 0);
  const owningBreakIndex = breakIndexes.find((index) => index >= activeIndex);
  if (owningBreakIndex !== undefined) {
    const block = model.blocks[owningBreakIndex];
    const sectionNumber = breakIndexes.indexOf(owningBreakIndex) + 1;
    return {
      id: `break:${block.id}`,
      label: `Section ${sectionNumber} only`,
      page: { ...(block.sectionPage ?? model.page ?? {}) },
      breakBlockId: block.id,
    };
  }
  return {
    id: "final",
    label: `Final section only (section ${breakIndexes.length + 1})`,
    page: { ...(model.page ?? {}) },
  };
}

export function applyDocxPageDraft(
  model: DocxModel,
  target: DocxPageDraftTarget,
  page: DocxPageSettings,
): DocxModel {
  if (!target.breakBlockId) return { ...model, page: { ...page } };
  return {
    ...model,
    blocks: model.blocks.map((block) =>
      block.id === target.breakBlockId
        ? { ...block, sectionPage: { ...page } }
        : block,
    ),
  };
}

export function docxPageDraftEquals(
  left: DocxPageSettings,
  right: DocxPageSettings,
) {
  return JSON.stringify(normalizePage(left)) === JSON.stringify(normalizePage(right));
}

function normalizePage(page: DocxPageSettings) {
  return Object.fromEntries(
    Object.entries(page)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
