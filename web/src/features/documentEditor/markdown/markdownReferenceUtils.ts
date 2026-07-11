import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { MarkdownReference } from "./markdownTypes";

interface PositionedMarkdownNode {
  type: string;
  children?: PositionedMarkdownNode[];
  identifier?: string;
  label?: string;
  url?: string;
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
}

interface SourceSpan {
  start: number;
  end: number;
}

interface DestinationSpan extends SourceSpan {
  wrapper: "angle" | "bare";
}

const referenceParser = unified().use(remarkParse).use(remarkGfm);

/**
 * Reference editing must use the same grammar as preview rendering. The parser
 * establishes the outer node boundary; the small lossless scanners below only
 * locate editable sub-ranges inside that already-validated node. When a source
 * spelling cannot be mapped unambiguously, the panel still exposes navigation
 * but deliberately leaves the source read-only.
 */
export function markdownReferences(content: string): MarkdownReference[] {
  const references: MarkdownReference[] = [];
  const root = referenceParser.parse(content) as PositionedMarkdownNode;

  walkMarkdownNodes(root, (node) => {
    const range = nodeRange(node);
    if (!range) return;
    const raw = content.slice(range.start, range.end);

    if (node.type === "link" || node.type === "image") {
      references.push(
        inlineReference(node, raw, range, node.type === "image" ? "image" : "link"),
      );
      return;
    }
    if (node.type === "linkReference" || node.type === "imageReference") {
      references.push(referenceUse(node, raw, range));
      return;
    }
    if (node.type === "definition") {
      references.push(referenceDefinition(node, raw, range));
      return;
    }
    if (node.type === "footnoteReference") {
      references.push(footnoteReference(node, raw, range));
      return;
    }
    if (node.type === "footnoteDefinition") {
      references.push(footnoteDefinition(node, raw, range));
    }
  });

  return references.sort((left, right) => left.start - right.start);
}

function inlineReference(
  node: PositionedMarkdownNode,
  raw: string,
  range: SourceSpan,
  kind: "link" | "image",
): MarkdownReference {
  const labelOpen = kind === "image" ? 1 : 0;
  const labelClose = findMatchingDelimiter(raw, labelOpen, "[", "]");
  const destinationOpen = labelClose === null ? -1 : labelClose + 1;
  const destinationClose =
    destinationOpen >= 0 && raw[destinationOpen] === "("
      ? findMatchingDelimiter(raw, destinationOpen, "(", ")")
      : null;
  const destination =
    destinationClose === null
      ? null
      : parseDestinationSpan(raw, destinationOpen + 1, destinationClose);
  const lossless =
    labelClose !== null &&
    destination !== null &&
    destinationClose === raw.length - 1 &&
    !raw.includes("\n") &&
    !raw.includes("\r");
  const labelStart = labelOpen + 1;
  const label = labelClose === null ? node.label ?? raw : raw.slice(labelStart, labelClose);
  const preservationReason = lossless
    ? undefined
    : "This reference uses a multiline or unsupported source form. Edit it in source mode.";

  return {
    kind,
    line: node.position?.start.line ?? 1,
    start: range.start,
    end: range.end,
    label,
    target: destination ? raw.slice(destination.start, destination.end) : node.url,
    labelStart: lossless ? range.start + labelStart : undefined,
    labelEnd: lossless && labelClose !== null ? range.start + labelClose : undefined,
    targetStart: lossless && destination ? range.start + destination.start : undefined,
    targetEnd: lossless && destination ? range.start + destination.end : undefined,
    labelEditable: lossless,
    targetEditable: lossless,
    targetWrapper: destination?.wrapper,
    preservationReason,
  };
}

function referenceUse(
  node: PositionedMarkdownNode,
  raw: string,
  range: SourceSpan,
): MarkdownReference {
  return {
    kind: node.type === "imageReference" ? "image" : "reference",
    role: "reference",
    identifier: node.identifier,
    line: node.position?.start.line ?? 1,
    start: range.start,
    end: range.end,
    label: node.label ?? raw,
    labelEditable: false,
    targetEditable: false,
    preservationReason:
      "Reference-style labels are source-only because changing one use can detach it from its definition.",
  };
}

function referenceDefinition(
  node: PositionedMarkdownNode,
  raw: string,
  range: SourceSpan,
): MarkdownReference {
  const syntax = parseDefinitionSyntax(raw);
  const lossless = Boolean(syntax) && !raw.includes("\n") && !raw.includes("\r");
  return {
    kind: "reference",
    role: "definition",
    identifier: node.identifier,
    line: node.position?.start.line ?? 1,
    start: range.start,
    end: range.end,
    label: syntax ? raw.slice(syntax.label.start, syntax.label.end) : node.label ?? raw,
    target: syntax
      ? raw.slice(syntax.destination.start, syntax.destination.end)
      : node.url,
    labelEditable: false,
    targetEditable: lossless,
    targetStart: lossless && syntax ? range.start + syntax.destination.start : undefined,
    targetEnd: lossless && syntax ? range.start + syntax.destination.end : undefined,
    targetWrapper: syntax?.destination.wrapper,
    labelPreservationReason:
      "Definition labels remain source-only until all reference-style uses can be renamed atomically.",
    targetPreservationReason: lossless
      ? undefined
      : "Multiline or unsupported definitions must be edited in source mode.",
    preservationReason: lossless
      ? "The target is editable; the definition label remains source-only."
      : "This definition uses a multiline or unsupported source form. Edit it in source mode.",
  };
}

function footnoteReference(
  node: PositionedMarkdownNode,
  raw: string,
  range: SourceSpan,
): MarkdownReference {
  return {
    kind: "footnote",
    role: "reference",
    identifier: node.identifier,
    line: node.position?.start.line ?? 1,
    start: range.start,
    end: range.end,
    label: raw,
    labelStart: range.start,
    labelEnd: range.end,
    labelEditable: false,
    targetEditable: false,
    preservationReason:
      "Rename the footnote definition to update every reference atomically.",
  };
}

function footnoteDefinition(
  node: PositionedMarkdownNode,
  raw: string,
  range: SourceSpan,
): MarkdownReference {
  const labelClose = raw.startsWith("[^")
    ? findMatchingDelimiter(raw, 0, "[", "]")
    : null;
  const colon = labelClose === null ? -1 : labelClose + 1;
  const validLabel = colon >= 0 && raw[colon] === ":";
  const bodyStart = validLabel ? skipHorizontalWhitespace(raw, colon + 1) : raw.length;
  const multiline = raw.includes("\n") || raw.includes("\r");
  const label = validLabel ? raw.slice(0, (labelClose ?? 0) + 1) : node.label ?? raw;
  return {
    kind: "footnote",
    role: "definition",
    identifier: node.identifier,
    line: node.position?.start.line ?? 1,
    start: range.start,
    end: range.end,
    label,
    target: validLabel ? raw.slice(bodyStart) : undefined,
    labelStart: validLabel ? range.start : undefined,
    labelEnd: validLabel && labelClose !== null ? range.start + labelClose + 1 : undefined,
    targetStart: validLabel && !multiline ? range.start + bodyStart : undefined,
    targetEnd: validLabel && !multiline ? range.end : undefined,
    labelEditable: validLabel,
    targetEditable: validLabel && !multiline,
    targetPreservationReason: multiline
      ? "Multiline footnote bodies are source-only so indentation and blank lines remain byte-exact."
      : undefined,
    preservationReason: !validLabel
      ? "This footnote form could not be mapped safely. Edit it in source mode."
      : multiline
        ? "The identifier can be renamed atomically; its multiline body remains source-only."
        : undefined,
  };
}

function parseDefinitionSyntax(raw: string) {
  const firstNonSpace = raw.search(/[^ ]/);
  if (firstNonSpace < 0 || firstNonSpace > 3 || raw[firstNonSpace] !== "[") {
    return null;
  }
  const labelEnd = findMatchingDelimiter(raw, firstNonSpace, "[", "]");
  if (labelEnd === null || raw[labelEnd + 1] !== ":") return null;
  const destinationStart = skipMarkdownWhitespace(raw, labelEnd + 2);
  const destination = parseDefinitionDestination(raw, destinationStart);
  if (!destination) return null;
  return {
    label: { start: firstNonSpace + 1, end: labelEnd },
    destination,
  };
}

function parseDefinitionDestination(
  raw: string,
  start: number,
): DestinationSpan | null {
  if (raw[start] === "<") {
    const close = findUnescapedCharacter(raw, start + 1, ">");
    return close === null
      ? null
      : { start: start + 1, end: close, wrapper: "angle" };
  }
  let index = start;
  let depth = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (/\s/.test(character) && depth === 0) break;
    if (character === "(") depth += 1;
    if (character === ")") {
      if (depth === 0) return null;
      depth -= 1;
    }
    index += 1;
  }
  return depth === 0 && index > start
    ? { start, end: index, wrapper: "bare" }
    : null;
}

function parseDestinationSpan(
  raw: string,
  bodyStart: number,
  bodyEnd: number,
): DestinationSpan | null {
  const start = skipMarkdownWhitespace(raw, bodyStart);
  if (start > bodyEnd) return null;
  if (raw[start] === "<") {
    const close = findUnescapedCharacter(raw, start + 1, ">", bodyEnd);
    return close === null
      ? null
      : { start: start + 1, end: close, wrapper: "angle" };
  }
  let index = start;
  let depth = 0;
  while (index < bodyEnd) {
    const character = raw[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (/\s/.test(character) && depth === 0) break;
    if (character === "(") depth += 1;
    if (character === ")") {
      if (depth === 0) return null;
      depth -= 1;
    }
    index += 1;
  }
  return depth === 0 ? { start, end: index, wrapper: "bare" } : null;
}

function nodeRange(node: PositionedMarkdownNode): SourceSpan | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

function walkMarkdownNodes(
  node: PositionedMarkdownNode,
  visit: (node: PositionedMarkdownNode) => void,
) {
  visit(node);
  node.children?.forEach((child) => walkMarkdownNodes(child, visit));
}

function findMatchingDelimiter(
  value: string,
  openIndex: number,
  open: string,
  close: string,
) {
  if (value[openIndex] !== open) return null;
  let depth = 1;
  for (let index = openIndex + 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === open) depth += 1;
    if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function findUnescapedCharacter(
  value: string,
  start: number,
  expected: string,
  end = value.length,
) {
  for (let index = start; index < end; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === expected) return index;
  }
  return null;
}

function skipHorizontalWhitespace(value: string, start: number) {
  let index = start;
  while (index < value.length && (value[index] === " " || value[index] === "\t")) {
    index += 1;
  }
  return index;
}

function skipMarkdownWhitespace(value: string, start: number) {
  let index = start;
  while (index < value.length && /\s/.test(value[index])) index += 1;
  return index;
}
