import type { MarkdownReference } from "./markdownEditorUtils";
import { markdownReferences } from "./markdownReferenceUtils";

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
    if (!reference.labelEditable) return;
    if (reference.labelStart === undefined || reference.labelEnd === undefined) {
      return;
    }
    if (reference.kind === "footnote" && reference.role === "definition") {
      renameMarkdownFootnote(reference, value);
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
    if (!reference.targetEditable) return;
    if (reference.targetStart === undefined || reference.targetEnd === undefined) {
      return;
    }
    if (
      reference.kind !== "footnote" &&
      !validMarkdownDestination(value, reference.targetWrapper ?? "bare")
    ) {
      reportReferenceEditError(
        reference.targetWrapper === "angle"
          ? "Angle-bracket destinations cannot contain a line break or an unescaped > character."
          : "Bare Markdown destinations cannot contain whitespace and must have balanced parentheses.",
      );
      return;
    }
    replaceMarkdownReferenceRange(
      reference.targetStart,
      reference.targetEnd,
      reference.kind === "footnote" ? formatMarkdownFootnoteBody(value) : value,
    );
  }

  function renameMarkdownFootnote(reference: MarkdownReference, value: string) {
    const currentIdentifier = normalizeMarkdownIdentifier(
      reference.identifier ?? markdownReferenceInputLabel(reference),
    );
    const nextId = normalizeMarkdownFootnoteId(value);
    const nextIdentifier = normalizeMarkdownIdentifier(nextId);
    if (currentIdentifier === nextIdentifier) return;

    const references = markdownReferences(content);
    const collision = references.some(
      (candidate) =>
        candidate.kind === "footnote" &&
        candidate.role === "definition" &&
        candidate.start !== reference.start &&
        normalizeMarkdownIdentifier(candidate.identifier ?? "") === nextIdentifier,
    );
    if (collision) {
      reportReferenceEditError(
        `Footnote [^${nextId}] already exists. Choose a unique identifier.`,
      );
      return;
    }

    const matchingRanges = references
      .filter(
        (candidate) =>
          candidate.kind === "footnote" &&
          normalizeMarkdownIdentifier(candidate.identifier ?? "") ===
            currentIdentifier &&
          candidate.labelStart !== undefined &&
          candidate.labelEnd !== undefined,
      )
      .map((candidate) => ({
        start: candidate.labelStart as number,
        end: candidate.labelEnd as number,
      }));
    if (matchingRanges.length === 0) return;
    const useCount = Math.max(0, matchingRanges.length - 1);
    if (
      useCount > 0 &&
      !globalThis.confirm(
        `Rename [^${markdownReferenceInputLabel(reference)}] to [^${nextId}] and update ${useCount} reference${useCount === 1 ? "" : "s"}?`,
      )
    ) {
      return;
    }

    const replacement = `[^${nextId}]`;
    const nextContent = matchingRanges
      .sort((left, right) => right.start - left.start)
      .reduce(
        (current, range) =>
          `${current.slice(0, range.start)}${replacement}${current.slice(range.end)}`,
        content,
      );
    updateContent(nextContent);
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
      .replace(/[[\]\r\n]+/g, "-")
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

function normalizeMarkdownIdentifier(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function validMarkdownDestination(value: string, wrapper: "angle" | "bare") {
  if (/[\r\n]/.test(value)) return false;
  if (wrapper === "angle") return !hasUnescapedCharacter(value, ">");
  if (/\s/.test(value)) return false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0;
}

function hasUnescapedCharacter(value: string, expected: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === expected) return true;
  }
  return false;
}

function reportReferenceEditError(message: string) {
  globalThis.alert(message);
}
