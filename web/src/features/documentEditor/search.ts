import type {
  DelimitedTableModel,
  DocxModel,
  PptxModel,
  TextModel,
  XlsxModel,
} from "./models";
import { isRecord } from "./models";

export interface TextSearchOptions {
  query: string;
  replacement?: string;
  matchCase?: boolean;
}

export interface TextReplacementResult {
  model: unknown;
  replacements: number;
}

export function countModelMatches(model: unknown, options: TextSearchOptions) {
  return transformTextFields(model, options, "count").replacements;
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
      if (remainingMode === "first" && replacements > 0) return block;
      const result = transformString(block.text, options, remainingMode);
      replacements += result.replacements;
      if (remainingMode === "first" && result.replacements > 0) {
        remainingMode = "count";
      }
      return mode === "count" || result.replacements === 0
        ? block
        : { ...block, text: result.value };
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
          if (remainingMode === "first" && replacements > 0) return cell;
          const source = cell.formula ? `=${cell.formula}` : cell.value;
          const result = transformString(source, options, remainingMode);
          replacements += result.replacements;
          if (remainingMode === "first" && result.replacements > 0) {
            remainingMode = "count";
          }
          if (mode === "count" || result.replacements === 0) return cell;
          return result.value.startsWith("=")
            ? { ...cell, value: "", formula: result.value.slice(1) }
            : { ...cell, value: result.value, formula: undefined };
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
  if (mode === "count") {
    return { value, replacements: countMatches(value, options.query, options.matchCase) };
  }
  const flags = options.matchCase ? "g" : "gi";
  const pattern = new RegExp(escapeRegExp(options.query), flags);
  let replacements = 0;
  const replacement = options.replacement ?? "";
  const next = value.replace(pattern, (match) => {
    if (mode === "first" && replacements > 0) return match;
    replacements += 1;
    return replacement;
  });
  return { value: next, replacements };
}

function countMatches(value: string, query: string, matchCase = false) {
  const haystack = matchCase ? value : value.toLocaleLowerCase();
  const needle = matchCase ? query : query.toLocaleLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
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
