import type { DocxModel } from "../shared/models";

/**
 * Remove backing comment/note records only after their last visible reference
 * disappears. The model permits repeated IDs, so deleting one paragraph must
 * not garbage-collect a part that another paragraph still owns.
 */
export function deleteDocxBlockAndUnreferencedParts(
  model: DocxModel,
  blockId: string,
) {
  const removed = model.blocks.find((block) => block.id === blockId);
  if (!removed) return model;
  const blocks = model.blocks.filter((block) => block.id !== blockId);
  const referencedComments = new Set(
    blocks.flatMap((block) => [
      ...(block.commentId ? [block.commentId] : []),
      ...(block.commentRanges?.map((range) => range.commentId) ?? []),
    ]),
  );
  const referencedFootnotes = new Set(
    blocks.flatMap((block) => [
      ...(block.footnoteId ? [block.footnoteId] : []),
      ...(block.noteReferences
        ?.filter((reference) => reference.kind === "footnote")
        .map((reference) => reference.id) ?? []),
    ]),
  );
  const referencedEndnotes = new Set(
    blocks.flatMap((block) => [
      ...(block.endnoteId ? [block.endnoteId] : []),
      ...(block.noteReferences
        ?.filter((reference) => reference.kind === "endnote")
        .map((reference) => reference.id) ?? []),
    ]),
  );
  const removedCommentIds = new Set([
    ...(removed.commentId ? [removed.commentId] : []),
    ...(removed.commentRanges?.map((range) => range.commentId) ?? []),
  ]);
  const removedFootnoteIds = new Set([
    ...(removed.footnoteId ? [removed.footnoteId] : []),
    ...(removed.noteReferences
      ?.filter((reference) => reference.kind === "footnote")
      .map((reference) => reference.id) ?? []),
  ]);
  const removedEndnoteIds = new Set([
    ...(removed.endnoteId ? [removed.endnoteId] : []),
    ...(removed.noteReferences
      ?.filter((reference) => reference.kind === "endnote")
      .map((reference) => reference.id) ?? []),
  ]);
  return {
    ...model,
    blocks,
    comments: model.comments?.filter(
      (comment) =>
        !removedCommentIds.has(comment.id) || referencedComments.has(comment.id),
    ),
    footnotes: model.footnotes?.filter(
      (note) =>
        !removedFootnoteIds.has(note.id) || referencedFootnotes.has(note.id),
    ),
    endnotes: model.endnotes?.filter(
      (note) => !removedEndnoteIds.has(note.id) || referencedEndnotes.has(note.id),
    ),
  };
}
