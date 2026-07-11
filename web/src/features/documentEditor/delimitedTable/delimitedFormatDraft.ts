import type { DelimitedTableModel } from "../shared/models";

export type DelimitedFormatDraft = Pick<
  DelimitedTableModel,
  | "bom"
  | "delimiter"
  | "encoding"
  | "escapePolicy"
  | "lineEnding"
  | "quoteCharacter"
  | "quoteStyle"
  | "trailingNewline"
>;

const FORMAT_KEYS: Array<keyof DelimitedFormatDraft> = [
  "encoding",
  "bom",
  "delimiter",
  "quoteCharacter",
  "escapePolicy",
  "quoteStyle",
  "lineEnding",
  "trailingNewline",
];

export function delimitedFormatDraft(model: DelimitedTableModel): DelimitedFormatDraft {
  return Object.fromEntries(FORMAT_KEYS.map((key) => [key, model[key]]));
}

export function changedDelimitedFormatKeys(
  baseline: DelimitedFormatDraft,
  draft: DelimitedFormatDraft,
) {
  return FORMAT_KEYS.filter((key) => baseline[key] !== draft[key]);
}

export function delimitedEncodingIssue(
  rows: string[][],
  encoding?: string,
  bom = false,
) {
  if ((encoding === "utf-16le" || encoding === "utf-16be") && !bom) {
    return "UTF-16 requires a BOM so the file can be decoded correctly when reopened";
  }
  if (encoding === "windows-1252" && bom) {
    return "Windows-1252 does not support a BOM";
  }
  if (encoding !== "windows-1252") return null;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < rows[rowIndex].length; columnIndex += 1) {
      const value = rows[rowIndex][columnIndex];
      for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (!isWindows1252CodePoint(codePoint)) {
          return `Windows-1252 cannot encode ${character} at row ${rowIndex + 1}, column ${columnIndex + 1}`;
        }
      }
    }
  }
  return null;
}

export function delimitedFormatSample(
  rows: string[][],
  draft: DelimitedFormatDraft,
) {
  const delimiter = draft.delimiter ?? ",";
  const quote = draft.quoteCharacter ?? '"';
  const lineEnding = draft.lineEnding ?? "\n";
  const alwaysQuote = draft.quoteStyle === "always";
  return rows
    .slice(0, 3)
    .map((row) =>
      row
        .map((cell) => {
          const escaped =
            draft.escapePolicy === "backslash"
              ? cell.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`)
              : cell.replaceAll(quote, `${quote}${quote}`);
          const needsQuote =
            alwaysQuote ||
            cell.includes(delimiter) ||
            cell.includes("\n") ||
            cell.includes("\r") ||
            cell.includes(quote);
          return needsQuote ? `${quote}${escaped}${quote}` : escaped;
        })
        .join(delimiter),
    )
    .join(lineEnding);
}

function isWindows1252CodePoint(codePoint: number) {
  if (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)) return true;
  return new Set([
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
    0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
    0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178,
  ]).has(codePoint);
}
