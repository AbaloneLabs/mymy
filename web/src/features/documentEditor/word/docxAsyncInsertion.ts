import type { DocxBlock, DocxModel } from "../shared/models";

/**
 * Rebase an asynchronous block insertion onto the latest document model. The
 * operation identifies its semantic neighbor instead of retaining the model
 * object that existed when FileReader started, so unrelated edits made while
 * media decoding was pending remain present.
 */
export function insertDocxBlockAtStableAnchor(
  model: DocxModel,
  anchorBlockId: string | null,
  block: DocxBlock,
): { model: DocxModel } | { reason: string } {
  const anchorIndex = anchorBlockId
    ? model.blocks.findIndex((candidate) => candidate.id === anchorBlockId)
    : model.blocks.length - 1;
  if (anchorBlockId && anchorIndex < 0) {
    return { reason: "The insertion paragraph was deleted" };
  }
  const insertAt = Math.max(0, anchorIndex + 1);
  return {
    model: {
      ...model,
      blocks: [
        ...model.blocks.slice(0, insertAt),
        block,
        ...model.blocks.slice(insertAt),
      ],
    },
  };
}
