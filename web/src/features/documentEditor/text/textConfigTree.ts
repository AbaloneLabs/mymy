import type { ConfigEntry } from "./textStructuredTypes";

export interface ConfigTreeNode {
  path: string[];
  label: string;
  children: ConfigTreeNode[];
  entries: ConfigEntry[];
  firstLineIndex: number;
}

export function buildConfigTree(entries: ConfigEntry[]) {
  const root: ConfigTreeNode = {
    path: [],
    label: "root",
    children: [],
    entries: [],
    firstLineIndex: Number.POSITIVE_INFINITY,
  };
  const nodes = new Map<string, ConfigTreeNode>([[configTreePathKey([]), root]]);

  function nodeFor(path: string[]) {
    const key = configTreePathKey(path);
    const existing = nodes.get(key);
    if (existing) return existing;
    const parent = nodeFor(path.slice(0, -1));
    const node: ConfigTreeNode = {
      path,
      label: path.at(-1) ?? "root",
      children: [],
      entries: [],
      firstLineIndex: Number.POSITIVE_INFINITY,
    };
    parent.children.push(node);
    nodes.set(key, node);
    return node;
  }

  entries.forEach((entry) => {
    const parent = nodeFor(entry.path.slice(0, -1));
    parent.entries.push(entry);
    for (let index = 0; index <= entry.path.length - 1; index += 1) {
      const node = nodeFor(entry.path.slice(0, index));
      node.firstLineIndex = Math.min(node.firstLineIndex, entry.lineIndex);
    }
    parent.firstLineIndex = Math.min(parent.firstLineIndex, entry.lineIndex);
  });

  nodes.forEach((node) => {
    node.children.sort((left, right) => left.firstLineIndex - right.firstLineIndex);
    node.entries.sort((left, right) => left.lineIndex - right.lineIndex);
  });

  return root;
}

export function configTreePathKey(path: string[]) {
  return path.join("\u0000");
}
