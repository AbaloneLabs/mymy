import type { MarkdownReference } from "./markdownEditorUtils";

type MarkdownReferenceActionParams = {
  content: string;
  updateContent: (content: string) => void;
};

export function createMarkdownReferenceActions({
  content,
  updateContent,
}: MarkdownReferenceActionParams) {
  function replaceMarkdownReferenceRange(start: number, end: number, value: string) {
    const safeStart = Math.max(0, Math.min(content.length, start));
    const safeEnd = Math.max(safeStart, Math.min(content.length, end));
    updateContent(`${content.slice(0, safeStart)}${value}${content.slice(safeEnd)}`);
  }

  function updateMarkdownReferenceLabel(
    reference: MarkdownReference,
    value: string,
  ) {
    if (reference.labelStart === undefined || reference.labelEnd === undefined) {
      return;
    }
    replaceMarkdownReferenceRange(
      reference.labelStart,
      reference.labelEnd,
      reference.kind === "footnote"
        ? `[^${normalizeMarkdownFootnoteId(value)}]`
        : value,
    );
  }

  function updateMarkdownReferenceTarget(
    reference: MarkdownReference,
    value: string,
  ) {
    if (reference.targetStart === undefined || reference.targetEnd === undefined) {
      return;
    }
    replaceMarkdownReferenceRange(
      reference.targetStart,
      reference.targetEnd,
      reference.kind === "footnote" ? formatMarkdownFootnoteBody(value) : value,
    );
  }

  return {
    updateMarkdownReferenceLabel,
    updateMarkdownReferenceTarget,
  };
}

export function normalizeMarkdownFootnoteId(value: string) {
  return (
    value
      .trim()
      .replace(/^\[\^/, "")
      .replace(/\]$/, "")
      .replace(/\s+/g, "-") || "note"
  );
}

export function formatMarkdownFootnoteBody(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line, index) => {
      if (index === 0 || !line.trim()) return line;
      return `    ${line.replace(/^\s+/, "")}`;
    })
    .join("\n");
}

export function markdownReferenceInputLabel(reference: MarkdownReference) {
  if (reference.kind === "footnote") {
    return reference.label.replace(/^\[\^/, "").replace(/\]$/, "");
  }
  return reference.label;
}

export function singleLineMarkdownReferenceTarget(reference: MarkdownReference) {
  return (reference.target ?? "").replace(/\n\s*/g, " ");
}
