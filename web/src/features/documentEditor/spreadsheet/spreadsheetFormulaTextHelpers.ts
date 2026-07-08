export function spreadsheetFormulaTextAroundDelimiter(
  text: string,
  delimiter: string,
  side: "before" | "after",
) {
  if (!delimiter) return "#VALUE!";
  const index = text.indexOf(delimiter);
  if (index < 0) return "#N/A";
  return side === "before"
    ? text.slice(0, index)
    : text.slice(index + delimiter.length);
}

export function substituteSpreadsheetFormulaText(
  text: string,
  oldText: string,
  newText: string,
  instance: number | undefined,
) {
  if (!oldText) return text;
  const targetInstance =
    instance === undefined ? undefined : Math.max(1, Math.trunc(instance));
  if (targetInstance === undefined) return text.split(oldText).join(newText);
  let seen = 0;
  let index = 0;
  let output = "";
  while (index < text.length) {
    if (text.startsWith(oldText, index)) {
      seen += 1;
      output += seen === targetInstance ? newText : oldText;
      index += oldText.length;
    } else {
      output += text[index];
      index += 1;
    }
  }
  return output;
}

export function findSpreadsheetFormulaText(
  needle: string,
  haystack: string,
  start: number | undefined,
  insensitive: boolean,
) {
  const offset = Math.max(0, Math.trunc(start ?? 1) - 1);
  const searchNeedle = insensitive ? needle.toLowerCase() : needle;
  const searchHaystack = insensitive ? haystack.toLowerCase() : haystack;
  const index = searchHaystack.indexOf(searchNeedle, offset);
  return index < 0 ? 0 : index + 1;
}
