import type {
  DocxBlock,
  DocxComment,
  DocxContentControl,
  DocxModel,
  DocxRevision,
} from "../shared/models";

type DocxPartsActionOptions = {
  model: DocxModel;
  onChange: (model: DocxModel) => void;
  updateBlock: (index: number, patch: Partial<DocxBlock>) => void;
};

export function createDocxPartsActions({
  model,
  onChange,
  updateBlock,
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
    updateBlock(blockIndex, {
      text:
        typeof patch.text === "string"
          ? docxTextAfterContentControlChange(block.text, control.text, patch.text)
          : block.text,
      contentControls: block.contentControls?.map((item, index) =>
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
            block.commentId === comment.id ? { ...block, commentId: undefined } : block,
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
    onChange({
      ...model,
      blocks: model.blocks.map((block) =>
        block[blockKey] === note.id ? { ...block, [blockKey]: undefined } : block,
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

function docxTextAfterContentControlChange(
  blockText: string,
  previousText: string | undefined,
  nextText: string,
) {
  if (!previousText) return nextText;
  if (blockText === previousText) return nextText;
  const index = blockText.indexOf(previousText);
  if (index < 0) return blockText;
  return `${blockText.slice(0, index)}${nextText}${blockText.slice(index + previousText.length)}`;
}
