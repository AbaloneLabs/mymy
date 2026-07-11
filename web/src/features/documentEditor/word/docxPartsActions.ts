import type {
  DocxBlock,
  DocxComment,
  DocxContentControl,
  DocxModel,
  DocxRevision,
} from "../shared/models";
import { docxRunTextInputPatch } from "./docxTextRuns";

type DocxPartsActionOptions = {
  model: DocxModel;
  onChange: (model: DocxModel) => void;
  updateBlock: (index: number, patch: Partial<DocxBlock>) => void;
  onMutationError?: (message: string | null) => void;
};

export function createDocxPartsActions({
  model,
  onChange,
  updateBlock,
  onMutationError,
}: DocxPartsActionOptions) {
  function updateFieldInstruction(
    blockIndex: number,
    fieldIndex: number,
    instruction: string,
  ) {
    const block = model.blocks[blockIndex];
    const field = block?.fields?.[fieldIndex];
    if (!block || !field || field.source !== "simple") return;
    updateBlock(blockIndex, {
      fields: block.fields?.map((item, index) =>
        index === fieldIndex ? { ...item, instruction } : item,
      ),
    });
  }

  function updateContentControl(
    blockIndex: number,
    controlIndex: number,
    patch: Partial<DocxContentControl>,
  ) {
    const block = model.blocks[blockIndex];
    const control = block?.contentControls?.[controlIndex];
    if (!block || !control) return;
    const textChange =
      typeof patch.text === "string"
        ? docxContentControlTextChange(block, control, patch.text)
        : { block };
    if ("reason" in textChange) {
      onMutationError?.(`Content control was not changed. ${textChange.reason}`);
      return;
    }
    onMutationError?.(null);
    updateBlock(blockIndex, {
      ...textChange.block,
      contentControls: textChange.block.contentControls?.map((item, index) =>
        index === controlIndex ? { ...item, ...patch } : item,
      ),
    });
  }

  function updateRevisionAction(
    blockIndex: number,
    revisionIndex: number,
    action: DocxRevision["action"],
  ) {
    const block = model.blocks[blockIndex];
    const revision = block?.revisions?.[revisionIndex];
    if (!block || !revision) return;
    updateBlock(blockIndex, {
      revisions: block.revisions?.map((item, index) =>
        index === revisionIndex ? { ...item, action } : item,
      ),
    });
  }

  function updateTextPart(
    kind: "headers" | "footers",
    index: number,
    text: string,
  ) {
    const parts = model[kind] ?? [];
    onChange({
      ...model,
      [kind]: parts.map((part, partIndex) =>
        partIndex === index ? { ...part, text } : part,
      ),
    });
  }

  function updateComment(index: number, patch: Partial<DocxComment>) {
    const comments = model.comments ?? [];
    onChange({
      ...model,
      comments: comments.map((comment, commentIndex) =>
        commentIndex === index ? { ...comment, ...patch } : comment,
      ),
    });
  }

  function deleteComment(index: number) {
    const comments = model.comments ?? [];
    const comment = comments[index];
    onChange({
      ...model,
      blocks: comment
        ? model.blocks.map((block) =>
            block.commentId === comment.id ||
            block.commentRanges?.some((range) => range.commentId === comment.id)
              ? {
                  ...block,
                  commentId: undefined,
                  commentRanges: block.commentRanges?.filter(
                    (range) => range.commentId !== comment.id,
                  ),
                }
              : block,
          )
        : model.blocks,
      comments: comments.filter((_, commentIndex) => commentIndex !== index),
    });
  }

  function updateNote(
    kind: "footnotes" | "endnotes",
    index: number,
    text: string,
  ) {
    const notes = model[kind] ?? [];
    onChange({
      ...model,
      [kind]: notes.map((note, noteIndex) =>
        noteIndex === index ? { ...note, text } : note,
      ),
    });
  }

  function deleteNote(kind: "footnotes" | "endnotes", index: number) {
    const notes = model[kind] ?? [];
    const note = notes[index];
    if (!note) return;
    const blockKey = kind === "footnotes" ? "footnoteId" : "endnoteId";
    const noteKind = kind === "footnotes" ? "footnote" : "endnote";
    onChange({
      ...model,
      blocks: model.blocks.map((block) =>
        block[blockKey] === note.id ||
        block.noteReferences?.some(
          (reference) => reference.id === note.id && reference.kind === noteKind,
        )
          ? {
              ...block,
              [blockKey]: undefined,
              noteReferences: block.noteReferences?.filter(
                (reference) =>
                  reference.id !== note.id || reference.kind !== noteKind,
              ),
            }
          : block,
      ),
      [kind]: notes.filter((_, noteIndex) => noteIndex !== index),
    });
  }

  return {
    deleteComment,
    deleteNote,
    updateComment,
    updateContentControl,
    updateFieldInstruction,
    updateNote,
    updateRevisionAction,
    updateTextPart,
  };
}

export function docxContentControlTextChange(
  block: DocxBlock,
  control: DocxContentControl,
  nextText: string,
) {
  if (
    control.start !== undefined &&
    control.end !== undefined &&
    control.start >= 0 &&
    control.end >= control.start &&
    control.end <= block.text.length
  ) {
    const changed = docxRunTextInputPatch(
      block,
      control.start,
      control.end,
      nextText,
    );
    return changed
      ? ({ block: changed } as const)
      : ({ reason: "Control text is not editable" } as const);
  }
  const previousText = control.text;
  if (!previousText) {
    if (block.text !== "") {
      return {
        reason: "The control has no stable text range in a non-empty paragraph",
      } as const;
    }
    const changed = docxRunTextInputPatch(block, 0, 0, nextText);
    return changed ? { block: changed } as const : { reason: "Control text is not editable" } as const;
  }
  const first = block.text.indexOf(previousText);
  if (first < 0) {
    return { reason: "The control text no longer matches the paragraph" } as const;
  }
  if (block.text.indexOf(previousText, first + previousText.length) >= 0) {
    return {
      reason: "The same visible text occurs more than once and the model has no range anchor",
    } as const;
  }
  const changed = docxRunTextInputPatch(
    block,
    first,
    first + previousText.length,
    nextText,
  );
  return changed ? { block: changed } as const : { reason: "Control text is not editable" } as const;
}
