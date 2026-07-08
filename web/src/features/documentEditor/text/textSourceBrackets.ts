import type {
  SourceBracketMatch,
  SourceBracketPairFragment,
  SourceBracketPosition,
} from "./textSourceTypes";

const SOURCE_BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};
const SOURCE_REVERSE_BRACKET_PAIRS = Object.fromEntries(
  Object.entries(SOURCE_BRACKET_PAIRS).map(([open, close]) => [close, open]),
) as Record<string, string>;
const SOURCE_OPEN_BRACKETS = Object.keys(SOURCE_BRACKET_PAIRS);
const SOURCE_CLOSE_BRACKETS = Object.keys(SOURCE_REVERSE_BRACKET_PAIRS);

export function sourceBracketPairFragments(
  content: string,
  maxFragments = 5_000,
): SourceBracketPairFragment[] {
  const fragments: SourceBracketPairFragment[] = [];
  const stack: Array<{ char: string; fragmentIndex: number; level: number }> = [];
  let line = 1;
  let column = 0;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\n") {
      line += 1;
      column = 0;
      continue;
    }
    if (SOURCE_OPEN_BRACKETS.includes(char)) {
      if (fragments.length >= maxFragments) break;
      const level = stack.length;
      fragments.push({ line, column, level, matched: false });
      stack.push({ char, fragmentIndex: fragments.length - 1, level });
    } else if (SOURCE_CLOSE_BRACKETS.includes(char)) {
      if (fragments.length >= maxFragments) break;
      const open = SOURCE_REVERSE_BRACKET_PAIRS[char];
      const previous = stack.at(-1);
      if (previous?.char === open) {
        fragments[previous.fragmentIndex] = {
          ...fragments[previous.fragmentIndex],
          matched: true,
        };
        fragments.push({
          line,
          column,
          level: previous.level,
          matched: true,
        });
        stack.pop();
      } else {
        fragments.push({ line, column, level: 0, matched: false });
      }
    }
    column += 1;
  }
  return fragments;
}

export function sourceBracketMatch(
  content: string,
  offset: number,
): SourceBracketMatch | null {
  const bracket = sourceBracketAtCursor(content, offset);
  if (!bracket) return null;
  const matchOffset =
    bracket.direction === "forward"
      ? scanBracketForward(content, bracket.offset, bracket.char)
      : scanBracketBackward(content, bracket.offset, bracket.char);
  const focus = sourceBracketPosition(content, bracket.offset, bracket.char);
  if (matchOffset === null) {
    return { matched: false, focus };
  }
  const matchChar = content[matchOffset] ?? "";
  const match = sourceBracketPosition(content, matchOffset, matchChar);
  return bracket.direction === "forward"
    ? { matched: true, open: focus, close: match }
    : { matched: true, open: match, close: focus };
}

function sourceBracketAtCursor(content: string, offset: number) {
  const candidates = [offset - 1, offset].filter(
    (index) => index >= 0 && index < content.length,
  );
  for (const candidate of candidates) {
    const char = content[candidate];
    if (SOURCE_OPEN_BRACKETS.includes(char)) {
      return { offset: candidate, char, direction: "forward" as const };
    }
    if (SOURCE_CLOSE_BRACKETS.includes(char)) {
      return { offset: candidate, char, direction: "backward" as const };
    }
  }
  return null;
}

function scanBracketForward(content: string, start: number, open: string) {
  const close = SOURCE_BRACKET_PAIRS[open];
  if (!close) return null;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function scanBracketBackward(content: string, start: number, close: string) {
  const open = SOURCE_REVERSE_BRACKET_PAIRS[close];
  if (!open) return null;
  let depth = 0;
  for (let index = start; index >= 0; index -= 1) {
    const char = content[index];
    if (char === close) depth += 1;
    if (char === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function sourceBracketPosition(
  content: string,
  offset: number,
  char: string,
): SourceBracketPosition {
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return {
    char,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
