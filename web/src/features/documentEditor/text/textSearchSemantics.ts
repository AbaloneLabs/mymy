/** Literal replacement text must never interpret JavaScript's `$&`/`$1`
 * tokens. Regex mode intentionally delegates those documented substitutions
 * to the runtime after the user opted into regex semantics. */
export function replaceSearchMatches(
  input: string,
  pattern: RegExp,
  replacement: string,
  regexMode: boolean,
) {
  pattern.lastIndex = 0;
  return regexMode
    ? input.replace(pattern, replacement)
    : input.replace(pattern, () => replacement);
}

export function regexSearchError(query: string, regexMode: boolean) {
  if (!query || !regexMode) return null;
  try {
    new RegExp(query, "u");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression";
  }
}

export function advanceZeroWidthRegex(regex: RegExp, content: string) {
  const current = regex.lastIndex;
  if (current >= content.length) {
    regex.lastIndex = content.length + 1;
    return false;
  }
  const codePoint = content.codePointAt(current);
  regex.lastIndex = current + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
  return true;
}
