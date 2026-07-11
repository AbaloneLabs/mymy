export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface MarkdownHeading {
  line: number;
  level: number;
  text: string;
}

export interface MarkdownHeadingAnchor {
  line: number;
  id: string;
  baseId: string;
  duplicateIndex: number;
  duplicateCount: number;
}

export interface MarkdownReference {
  kind: "link" | "image" | "footnote" | "definition" | "reference";
  role?: "definition" | "reference";
  identifier?: string;
  line: number;
  start: number;
  end: number;
  label: string;
  target?: string;
  labelStart?: number;
  labelEnd?: number;
  targetStart?: number;
  targetEnd?: number;
  labelEditable?: boolean;
  targetEditable?: boolean;
  targetWrapper?: "angle" | "bare";
  preservationReason?: string;
  labelPreservationReason?: string;
  targetPreservationReason?: string;
}

export type MarkdownTableAlignment = "default" | "left" | "center" | "right";

export interface MarkdownTableCellSpan {
  start: number;
  end: number;
}

export interface MarkdownTableModel {
  startLine: number;
  endLine: number;
  headers: string[];
  headerSpans: MarkdownTableCellSpan[];
  alignments: MarkdownTableAlignment[];
  alignmentSpans: MarkdownTableCellSpan[];
  rows: string[][];
  rowSpans: MarkdownTableCellSpan[][];
}
