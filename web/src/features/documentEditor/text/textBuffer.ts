export interface TextLineRange {
  startLineIndex: number;
  endLineIndex: number;
}

interface TextPiece {
  source: "original" | "added";
  start: number;
  length: number;
}

export interface TextLineWindowEntry {
  lineIndex: number;
  start: number;
  end: number;
  text: string;
}

/**
 * The source editor stores files as plain strings for persistence, but virtual
 * editing needs deterministic line replacement without constructing DOM nodes
 * for the whole file. These helpers form the small buffer boundary shared by
 * the large-file viewport and future language-service adapters.
 */
export function replaceTextLineRange(
  content: string,
  range: TextLineRange,
  replacement: string,
) {
  const lineRanges = textLineOffsetRanges(content);
  const start = lineRanges[range.startLineIndex]?.start ?? content.length;
  const end =
    lineRanges[Math.max(range.startLineIndex, range.endLineIndex - 1)]?.end ??
    content.length;
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

/**
 * The piece table keeps interactive large-file edits proportional to the
 * visible replacement. A complete string is materialized only when the user
 * applies the window transaction and hands it back to persistence.
 */
export class PieceTableTextBuffer {
  private readonly original: string;
  private added = "";
  private pieces: TextPiece[];

  constructor(content: string) {
    this.original = content;
    this.pieces = content.length
      ? [{ source: "original", start: 0, length: content.length }]
      : [];
  }

  get length() {
    return this.pieces.reduce((total, piece) => total + piece.length, 0);
  }

  replace(start: number, end: number, replacement: string) {
    const safeStart = Math.max(0, Math.min(this.length, start));
    const safeEnd = Math.max(safeStart, Math.min(this.length, end));
    const replacementPiece = replacement.length
      ? {
          source: "added" as const,
          start: this.added.length,
          length: replacement.length,
        }
      : null;
    this.added += replacement;
    const next: TextPiece[] = [];
    let inserted = false;
    let offset = 0;

    for (const piece of this.pieces) {
      const pieceStart = offset;
      const pieceEnd = pieceStart + piece.length;
      if (pieceEnd <= safeStart) {
        next.push(piece);
      } else if (pieceStart >= safeEnd) {
        if (!inserted && replacementPiece) next.push(replacementPiece);
        inserted = true;
        next.push(piece);
      } else {
        if (pieceStart < safeStart) {
          next.push({
            ...piece,
            length: safeStart - pieceStart,
          });
        }
        if (!inserted && replacementPiece) next.push(replacementPiece);
        inserted = true;
        if (pieceEnd > safeEnd) {
          const consumed = safeEnd - pieceStart;
          next.push({
            ...piece,
            start: piece.start + consumed,
            length: pieceEnd - safeEnd,
          });
        }
      }
      offset = pieceEnd;
    }
    if (!inserted && replacementPiece) next.push(replacementPiece);
    this.pieces = mergeAdjacentPieces(next);
  }

  slice(start = 0, end = this.length) {
    const safeStart = Math.max(0, Math.min(this.length, start));
    const safeEnd = Math.max(safeStart, Math.min(this.length, end));
    const fragments: string[] = [];
    let offset = 0;
    for (const piece of this.pieces) {
      const pieceStart = offset;
      const pieceEnd = pieceStart + piece.length;
      if (pieceEnd > safeStart && pieceStart < safeEnd) {
        const localStart = Math.max(0, safeStart - pieceStart);
        const localEnd = Math.min(piece.length, safeEnd - pieceStart);
        fragments.push(
          this.pieceSource(piece).slice(
            piece.start + localStart,
            piece.start + localEnd,
          ),
        );
      }
      if (pieceEnd >= safeEnd) break;
      offset = pieceEnd;
    }
    return fragments.join("");
  }

  toString() {
    return this.slice();
  }

  private pieceSource(piece: TextPiece) {
    return piece.source === "original" ? this.original : this.added;
  }
}

export function textLineStartOffsets(content: string) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

export function textLineWindow(
  content: string,
  lineStarts: number[],
  startLineIndex: number,
  endLineIndex: number,
): TextLineWindowEntry[] {
  const start = Math.max(0, Math.min(lineStarts.length, startLineIndex));
  const end = Math.max(start, Math.min(lineStarts.length, endLineIndex));
  const entries: TextLineWindowEntry[] = [];
  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    const lineStart = lineStarts[lineIndex] ?? content.length;
    const nextLineStart = lineStarts[lineIndex + 1] ?? content.length;
    let textEnd = nextLineStart;
    if (textEnd > lineStart && content.charCodeAt(textEnd - 1) === 10) textEnd -= 1;
    if (textEnd > lineStart && content.charCodeAt(textEnd - 1) === 13) textEnd -= 1;
    entries.push({
      lineIndex,
      start: lineStart,
      end: nextLineStart,
      text: content.slice(lineStart, textEnd),
    });
  }
  return entries;
}

export function textLineWindowRange(
  contentLength: number,
  lineStarts: number[],
  startLineIndex: number,
  endLineIndex: number,
) {
  return {
    start: lineStarts[startLineIndex] ?? contentLength,
    end: lineStarts[endLineIndex] ?? contentLength,
  };
}

export function textLineOffsetRanges(content: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  if (content.length === 0) return [{ start: 0, end: 0 }];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") continue;
    ranges.push({ start, end: index + 1 });
    start = index + 1;
  }
  if (start < content.length) {
    ranges.push({ start, end: content.length });
  }
  return ranges;
}

function mergeAdjacentPieces(pieces: TextPiece[]) {
  return pieces.reduce<TextPiece[]>((merged, piece) => {
    if (piece.length === 0) return merged;
    const previous = merged.at(-1);
    if (
      previous &&
      previous.source === piece.source &&
      previous.start + previous.length === piece.start
    ) {
      previous.length += piece.length;
    } else {
      merged.push({ ...piece });
    }
    return merged;
  }, []);
}
