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
  line: number;
  start: number;
  end: number;
  label: string;
  target?: string;
  labelStart?: number;
  labelEnd?: number;
  targetStart?: number;
  targetEnd?: number;
}

export type MarkdownTableAlignment = "default" | "left" | "center" | "right";

export interface MarkdownTableModel {
  startLine: number;
  endLine: number;
  headers: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
}
