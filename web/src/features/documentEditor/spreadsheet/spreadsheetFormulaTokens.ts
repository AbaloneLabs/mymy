export type SpreadsheetFormulaToken =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "error"; value: string }
  | { type: "identifier"; value: string }
  | { type: "structuredReference"; value: string }
  | { type: "operator"; value: string };

export function tokenizeSpreadsheetFormula(formula: string): SpreadsheetFormulaToken[] {
  const source = formula.trim().replace(/^=/, "");
  const decimalComma = spreadsheetFormulaUsesDecimalComma(source);
  const tokens: SpreadsheetFormulaToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = nextSpreadsheetFormulaNumberToken(source.slice(index), decimalComma);
    if (number) {
      tokens.push({ type: "number", value: number.value });
      index += number.length;
      continue;
    }
    const structuredReference = nextSpreadsheetFormulaStructuredReferenceToken(source.slice(index));
    if (structuredReference) {
      tokens.push({ type: "structuredReference", value: structuredReference.value });
      index += structuredReference.length;
      continue;
    }
    if (/[()+\-*/^,;:%]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    const comparison = /^(?:<>|<=|>=|=|<|>|&)/.exec(source.slice(index));
    if (comparison) {
      tokens.push({ type: "operator", value: comparison[0] });
      index += comparison[0].length;
      continue;
    }
    if (char === '"') {
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        if (source[index] === '"') break;
        value += source[index];
        index += 1;
      }
      if (source[index] !== '"') throw new Error("Unterminated formula string");
      tokens.push({ type: "string", value });
      index += 1;
      continue;
    }
    const error = /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)/i.exec(
      source.slice(index),
    );
    if (error) {
      tokens.push({ type: "error", value: error[0].toUpperCase() });
      index += error[0].length;
      continue;
    }
    const quotedSheetReference =
      /^'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?\d+/.exec(source.slice(index));
    if (quotedSheetReference) {
      tokens.push({ type: "identifier", value: quotedSheetReference[0] });
      index += quotedSheetReference[0].length;
      continue;
    }
    const identifier = /^\$?[A-Za-z_][A-Za-z0-9_.$!]*/.exec(source.slice(index));
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    throw new Error("Invalid formula token");
  }
  return tokens;
}

function nextSpreadsheetFormulaStructuredReferenceToken(source: string) {
  const tableName = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source)?.[0] ?? "";
  const bracketStart = tableName ? tableName.length : 0;
  if (source[bracketStart] !== "[") return null;
  let depth = 0;
  for (let index = bracketStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        const length = index + 1;
        return {
          length,
          value: source.slice(0, length),
        };
      }
    }
  }
  return null;
}

function spreadsheetFormulaUsesDecimalComma(source: string) {
  return (
    /\d,\d/.test(source) &&
    (source.includes(";") || !/[A-Za-z_][A-Za-z0-9_.$!]*\s*\(/.test(source))
  );
}

function nextSpreadsheetFormulaNumberToken(source: string, decimalComma: boolean) {
  const pattern = decimalComma
    ? /^(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/
    : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
  const match = pattern.exec(source);
  if (!match) return null;
  return {
    length: match[0].length,
    value: decimalComma ? match[0].replace(",", ".") : match[0],
  };
}
