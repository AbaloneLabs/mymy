import { textSourceOutline } from "./textSourceNavigation";
import type { SourceDiagnostic } from "./textStructuredTypes";
import type { SourceOutlineItem, SourceSelectionRange } from "./textSourceTypes";

export interface SourceCompletionItem {
  label: string;
  kind: string;
  detail?: string;
}

export interface SourceHoverInfo {
  label: string;
  detail: string;
  line: number;
  column: number;
}

export interface SourceLanguageServiceState {
  diagnostics: SourceDiagnostic[];
  outline: SourceOutlineItem[];
}

const KEYWORDS_BY_LANGUAGE: Record<string, string[]> = {
  bash: ["case", "do", "done", "elif", "else", "fi", "for", "function", "if", "then", "while"],
  css: ["@media", "@supports", "align-items", "color", "display", "font-size", "grid-template-columns"],
  html: ["article", "button", "div", "form", "header", "main", "section"],
  javascript: ["async", "await", "class", "const", "export", "function", "import", "return", "type"],
  jsx: ["async", "await", "className", "const", "export", "function", "import", "return", "type"],
  python: ["async", "await", "class", "def", "elif", "else", "except", "finally", "import", "return"],
  rs: ["async", "await", "enum", "fn", "impl", "let", "match", "pub", "struct", "trait"],
  sql: ["alter", "create", "delete", "from", "insert", "join", "select", "update", "where"],
  tsx: ["async", "await", "className", "const", "export", "function", "import", "interface", "return", "type"],
  typescript: ["async", "await", "class", "const", "export", "function", "import", "interface", "return", "type"],
  xml: ["attribute", "element", "schema"],
};

/**
 * The text editor intentionally stays independent from heavyweight language
 * servers. This adapter gives the editor a stable integration boundary for
 * diagnostics, symbols, hover, and completions while the first implementation
 * remains deterministic and browser-only.
 */
export function sourceLanguageServiceState(
  content: string,
  language: string,
): SourceLanguageServiceState {
  return {
    diagnostics: languageServiceDiagnostics(content, language),
    outline: textSourceOutline(content, language),
  };
}

export function languageServiceDiagnostics(
  content: string,
  language: string,
): SourceDiagnostic[] {
  return [
    ...mergeConflictDiagnostics(content),
    ...pythonIndentDiagnostics(content, language),
  ].slice(0, 250);
}

export function languageServiceCompletions(
  content: string,
  language: string,
  offset: number,
): SourceCompletionItem[] {
  const prefix = wordPrefixAtOffset(content, offset).toLowerCase();
  const keywords = KEYWORDS_BY_LANGUAGE[language] ?? [];
  if (!prefix) {
    return keywords.slice(0, 12).map((label) => ({ label, kind: "keyword" }));
  }
  return keywords
    .filter((keyword) => keyword.toLowerCase().startsWith(prefix))
    .slice(0, 12)
    .map((label) => ({ label, kind: "keyword" }));
}

export function languageServiceCompletionRange(
  content: string,
  offset: number,
): SourceSelectionRange {
  const safeOffset = Math.max(0, Math.min(content.length, offset));
  const prefix = wordPrefixAtOffset(content, safeOffset);
  return {
    start: safeOffset - prefix.length,
    end: safeOffset,
  };
}

export function languageServiceHover(
  content: string,
  language: string,
  offset: number,
): SourceHoverInfo | null {
  const word = wordAtOffset(content, offset);
  if (!word) return null;
  const line = content.slice(0, offset).split("\n").length;
  const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const outlineMatch = textSourceOutline(content, language).find(
    (item) => item.label === word,
  );
  if (!outlineMatch) return null;
  return {
    label: word,
    detail: `${outlineMatch.kind} declared on line ${outlineMatch.line}`,
    line,
    column: offset - lineStart + 1,
  };
}

function mergeConflictDiagnostics(content: string): SourceDiagnostic[] {
  const markers = [/^<<<<<<<\s+/, /^=======\s*$/, /^>>>>>>>\s+/];
  return content
    .split("\n")
    .flatMap((line, index) =>
      markers.some((marker) => marker.test(line))
        ? [{
            line: index + 1,
            message: "Merge conflict marker must be resolved before saving.",
          }]
        : [],
    );
}

function pythonIndentDiagnostics(content: string, language: string): SourceDiagnostic[] {
  if (language !== "python") return [];
  return content
    .split("\n")
    .flatMap((line, index) =>
      /^(?=.*\t)(?=.* )[\t ]+\S/.test(line)
        ? [{
            line: index + 1,
            message: "Python indentation mixes tabs and spaces on the same line.",
          }]
        : [],
    );
}

function wordPrefixAtOffset(content: string, offset: number) {
  const before = content.slice(0, Math.max(0, offset));
  return /[A-Za-z_$@-][\w$@-]*$/.exec(before)?.[0] ?? "";
}

function wordAtOffset(content: string, offset: number) {
  const safeOffset = Math.max(0, Math.min(content.length, offset));
  const prefix = /[A-Za-z_$@-][\w$@-]*$/.exec(content.slice(0, safeOffset))?.[0] ?? "";
  const right = /^[A-Za-z_$@-][\w$@-]*/.exec(content.slice(safeOffset))?.[0] ?? "";
  return `${prefix}${right}` || null;
}
