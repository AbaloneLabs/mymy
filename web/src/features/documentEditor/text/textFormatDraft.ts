import type { TextModel } from "../shared/models";

export interface TextFileFormatDraft {
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  bom: boolean;
  lineEnding: "\n" | "\r\n" | "\r";
}

const WINDOWS_1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

export function textFileFormatDraft(model: TextModel): TextFileFormatDraft {
  return {
    encoding: normalizeTextEncoding(model.encoding),
    bom: model.bom === true,
    lineEnding: normalizeTextLineEnding(model.lineEnding),
  };
}

export function changedTextFileFormatKeys(
  baseline: TextFileFormatDraft,
  draft: TextFileFormatDraft,
) {
  return (Object.keys(baseline) as Array<keyof TextFileFormatDraft>).filter(
    (key) => baseline[key] !== draft[key],
  );
}

export function textFileFormatIssue(
  content: string,
  draft: TextFileFormatDraft,
) {
  if (
    (draft.encoding === "utf-16le" || draft.encoding === "utf-16be") &&
    !draft.bom
  ) {
    return "UTF-16 requires a BOM so the file can be decoded correctly when reopened.";
  }
  if (draft.encoding === "windows-1252" && draft.bom) {
    return "Windows-1252 does not support a BOM. Turn BOM off before applying.";
  }
  if (draft.encoding !== "windows-1252") return null;
  let line = 1;
  let column = 1;
  for (const character of content) {
    if (character === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isWindows1252CodePoint(codePoint)) {
      return `Windows-1252 cannot encode ${character} at line ${line}, column ${column}.`;
    }
    column += 1;
  }
  return null;
}

export function textFileFormatImpact(
  content: string,
  draft: TextFileFormatDraft,
) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lineBreaks = normalized.split("\n").length - 1;
  const serialized =
    draft.lineEnding === "\n"
      ? normalized
      : normalized.replaceAll("\n", draft.lineEnding);
  const estimatedBytes =
    draft.encoding === "utf-16le" || draft.encoding === "utf-16be"
      ? serialized.length * 2 + (draft.bom ? 2 : 0)
      : draft.encoding === "windows-1252"
        ? serialized.length
        : new TextEncoder().encode(serialized).length + (draft.bom ? 3 : 0);
  return {
    estimatedBytes,
    lineBreaks,
    sample: normalized
      .split("\n")
      .slice(0, 3)
      .join(draft.lineEnding)
      .replaceAll("\r", "␍")
      .replaceAll("\n", "␊\n"),
  };
}

function normalizeTextEncoding(value?: string): TextFileFormatDraft["encoding"] {
  if (value === "utf-16le" || value === "utf-16be" || value === "windows-1252") {
    return value;
  }
  return "utf-8";
}

function normalizeTextLineEnding(value?: string): TextFileFormatDraft["lineEnding"] {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}

function isWindows1252CodePoint(codePoint: number) {
  return (
    codePoint <= 0x7f ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WINDOWS_1252_EXTRA.has(codePoint)
  );
}
