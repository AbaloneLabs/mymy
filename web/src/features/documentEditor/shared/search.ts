import type {
  DelimitedTableModel,
  DocxModel,
  PptxModel,
  TextModel,
  XlsxModel,
} from "./models";
import { isRecord } from "./models";
import { docxRunTextDiffPatch } from "../word/docxTextRuns";
import { docxTextEditingBlockReason } from "../word/docxTextRuns";

export interface TextSearchOptions {
  query: string;
  replacement?: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regexSearch?: boolean;
}

export interface TextReplacementResult {
  model: unknown;
  replacements: number;
}

export function countModelMatches(model: unknown, options: TextSearchOptions) {
  return transformTextFields(model, options, "count").replacements;
}

export function modelSearchError(options: TextSearchOptions) {
  if (!options.query || !options.regexSearch) return null;
  return buildSearchRegex(options) ? null : "Invalid regular expression";
}

export function replaceFirstInModel(
  model: unknown,
  options: TextSearchOptions,
): TextReplacementResult {
  return transformTextFields(model, options, "first");
}

export function replaceAllInModel(
  model: unknown,
  options: TextSearchOptions,
): TextReplacementResult {
  return transformTextFields(model, options, "all");
}

function transformTextFields(
  model: unknown,
  options: TextSearchOptions,
  mode: "count" | "first" | "all",
): TextReplacementResult {
  const query = options.query;
  if (!query) return { model, replacements: 0 };
  if (isTextModel(model)) {
    const replacement = transformString(model.content, options, mode);
    return {
      model:
        mode === "count" || replacement.replacements === 0
          ? model
          : { ...model, content: replacement.value },
      replacements: replacement.replacements,
    };
  }
  if (isDelimitedModel(model)) {
    let remainingMode = mode;
    let replacements = 0;
    const rows = model.rows.map((row) =>
      row.map((cell) => {
        if (remainingMode === "first" && replacements > 0) return cell;
        const result = transformString(cell, options, remainingMode);
        replacements += result.replacements;
        if (remainingMode === "first" && result.replacements > 0) {
          remainingMode = "count";
        }
        return mode === "count" ? cell : result.value;
      }),
    );
    return {
      model: mode === "count" || replacements === 0 ? model : { ...model, rows },
      replacements,
    };
  }
  if (isDocxModel(model)) {
    let remainingMode = mode;
    let replacements = 0;
    const blocks = model.blocks.map((block) => {
      if (docxTextEditingBlockReason(block)) return block;
      if (remainingMode === "first" && replacements > 0) return block;
      const result = transformString(block.text, options, remainingMode);
      replacements += result.replacements;
      if (remainingMode === "first" && result.replacements > 0) {
        remainingMode = "count";
      }
      return mode === "count" || result.replacements === 0
        ? block
        : (docxRunTextDiffPatch(block, result.value) ?? {
            ...block,
            text: result.value,
          });
    });
    return {
      model: mode === "count" || replacements === 0 ? model : { ...model, blocks },
      replacements,
    };
  }
  if (isXlsxModel(model)) {
    let remainingMode = mode;
    let replacements = 0;
    const sheets = model.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.formula) return cell;
          if (remainingMode === "first" && replacements > 0) return cell;
          const source = cell.value;
          const result = transformString(source, options, remainingMode);
          replacements += result.replacements;
          if (remainingMode === "first" && result.replacements > 0) {
            remainingMode = "count";
          }
          if (mode === "count" || result.replacements === 0) return cell;
          return { ...cell, value: result.value };
        }),
      })),
    }));
    return {
      model: mode === "count" || replacements === 0 ? model : { ...model, sheets },
      replacements,
    };
  }
  if (isPptxModel(model)) {
    let remainingMode = mode;
    let replacements = 0;
    const slides = model.slides.map((slide) => ({
      ...slide,
      texts: slide.texts.map((text) => {
        if (text.complexText) return text;
        if (remainingMode === "first" && replacements > 0) return text;
        const result = transformString(text.text, options, remainingMode);
        replacements += result.replacements;
        if (remainingMode === "first" && result.replacements > 0) {
          remainingMode = "count";
        }
        return mode === "count" || result.replacements === 0
          ? text
          : { ...text, text: result.value };
      }),
    }));
    return {
      model: mode === "count" || replacements === 0 ? model : { ...model, slides },
      replacements,
    };
  }
  return { model, replacements: 0 };
}

function transformString(
  value: string,
  options: TextSearchOptions,
  mode: "count" | "first" | "all",
) {
  if (!options.query) return { value, replacements: 0 };
  const pattern = buildSearchRegex(options);
  if (!pattern) return { value, replacements: 0 };
  if (mode === "count") {
    return { value, replacements: countMatches(value, pattern) };
  }
  const replacement = options.replacement ?? "";
  const replacementPattern =
    mode === "first"
      ? new RegExp(pattern.source, pattern.flags.replace("g", ""))
      : pattern;
  const replacements =
    mode === "first" ? (pattern.test(value) ? 1 : 0) : countMatches(value, pattern);
  pattern.lastIndex = 0;
  const next = options.regexSearch
    ? value.replace(replacementPattern, replacement)
    : value.replace(replacementPattern, () => replacement);
  return { value: next, replacements };
}

function buildSearchRegex(options: TextSearchOptions) {
  const query = options.query;
  if (!query) return null;
  const source = options.regexSearch ? query : escapeRegExp(query);
  const wrapped = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
    : source;
  try {
    return new RegExp(wrapped, options.matchCase ? "gu" : "giu");
  } catch {
    return null;
  }
}

function countMatches(value: string, pattern: RegExp) {
  let count = 0;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    count += 1;
    if (match[0].length === 0) {
      const codePoint = value.codePointAt(pattern.lastIndex);
      pattern.lastIndex += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
  }
  return count;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTextModel(value: unknown): value is TextModel {
  return isRecord(value) && typeof value.content === "string";
}

function isDelimitedModel(value: unknown): value is DelimitedTableModel {
  return (
    isRecord(value) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"),
    )
  );
}

function isDocxModel(value: unknown): value is DocxModel {
  return (
    isRecord(value) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (block) => isRecord(block) && typeof block.text === "string",
    )
  );
}

function isXlsxModel(value: unknown): value is XlsxModel {
  return (
    isRecord(value) &&
    Array.isArray(value.sheets) &&
    value.sheets.every(
      (sheet) =>
        isRecord(sheet) &&
        Array.isArray(sheet.rows) &&
        sheet.rows.every(
          (row) =>
            isRecord(row) &&
            Array.isArray(row.cells) &&
            row.cells.every(
              (cell) => isRecord(cell) && typeof cell.value === "string",
            ),
        ),
    )
  );
}

function isPptxModel(value: unknown): value is PptxModel {
  return (
    isRecord(value) &&
    Array.isArray(value.slides) &&
    value.slides.every(
      (slide) =>
        isRecord(slide) &&
        Array.isArray(slide.texts) &&
        slide.texts.every(
          (text) => isRecord(text) && typeof text.text === "string",
        ),
    )
  );
}
