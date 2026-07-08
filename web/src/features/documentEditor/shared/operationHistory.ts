import { stableJson } from "./models";

export type EditorJsonPathSegment = string | number;

export type EditorModelOperation =
  | {
      kind: "add";
      path: EditorJsonPathSegment[];
      after: unknown;
    }
  | {
      kind: "remove";
      path: EditorJsonPathSegment[];
      before: unknown;
    }
  | {
      kind: "replace";
      path: EditorJsonPathSegment[];
      before: unknown;
      after: unknown;
    };

export interface EditorOperationEntry {
  id: string;
  label: string;
  timestamp: number;
  forward: EditorModelOperation[];
  inverse: EditorModelOperation[];
  beforeKey: string;
  afterKey: string;
  size: number;
}

const MAX_DIFF_OPERATIONS = 750;

/**
 * Document editors share one persistence shell, but their models differ by file
 * type. This operation layer records JSON-path changes instead of opaque
 * snapshots so undo/redo, conflict inspection, and future collaboration code can
 * reason about the same durable edit units without forcing every editor to adopt
 * the same internal data structure at once.
 */
export function createEditorOperationEntry({
  before,
  beforeKey = stableJson(before),
  after,
  afterKey = stableJson(after),
  label = "Edit",
}: {
  before: unknown;
  beforeKey?: string;
  after: unknown;
  afterKey?: string;
  label?: string;
}): EditorOperationEntry | null {
  if (beforeKey === afterKey) return null;
  const forward = diffEditorModels(before, after);
  const inverse = invertEditorOperations(forward);
  return {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    label,
    timestamp: Date.now(),
    forward,
    inverse,
    beforeKey,
    afterKey,
    size: beforeKey.length + afterKey.length + stableJson(forward).length,
  };
}

export function applyEditorOperations(
  model: unknown,
  operations: EditorModelOperation[],
) {
  return operations.reduce((draft, operation) => {
    if (operation.path.length === 0) {
      if (operation.kind === "remove") return undefined;
      return cloneJson(operation.kind === "add" ? operation.after : operation.after);
    }
    return applyEditorOperation(draft, operation);
  }, cloneJson(model));
}

function diffEditorModels(
  before: unknown,
  after: unknown,
  path: EditorJsonPathSegment[] = [],
  budget = { count: 0 },
): EditorModelOperation[] {
  if (stableJson(before) === stableJson(after)) return [];
  if (budget.count > MAX_DIFF_OPERATIONS) {
    return [{ kind: "replace", path, before: cloneJson(before), after: cloneJson(after) }];
  }
  if (!isJsonContainer(before) || !isJsonContainer(after)) {
    budget.count += 1;
    if (before === undefined) return [{ kind: "add", path, after: cloneJson(after) }];
    if (after === undefined) return [{ kind: "remove", path, before: cloneJson(before) }];
    return [
      {
        kind: "replace",
        path,
        before: cloneJson(before),
        after: cloneJson(after),
      },
    ];
  }
  if (Array.isArray(before) !== Array.isArray(after)) {
    budget.count += 1;
    return [{ kind: "replace", path, before: cloneJson(before), after: cloneJson(after) }];
  }
  const operations: EditorModelOperation[] = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      operations.push(
        ...diffEditorModels(before[index], after[index], [...path, index], budget),
      );
      if (budget.count > MAX_DIFF_OPERATIONS) break;
    }
    return maybeCollapseOperations(path, before, after, operations, budget);
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  Array.from(keys)
    .sort()
    .forEach((key) => {
      operations.push(
        ...diffEditorModels(beforeRecord[key], afterRecord[key], [...path, key], budget),
      );
    });
  return maybeCollapseOperations(path, before, after, operations, budget);
}

function maybeCollapseOperations(
  path: EditorJsonPathSegment[],
  before: unknown,
  after: unknown,
  operations: EditorModelOperation[],
  budget: { count: number },
) {
  budget.count += operations.length;
  if (operations.length > MAX_DIFF_OPERATIONS || budget.count > MAX_DIFF_OPERATIONS) {
    return [{ kind: "replace" as const, path, before: cloneJson(before), after: cloneJson(after) }];
  }
  return operations;
}

function invertEditorOperations(operations: EditorModelOperation[]) {
  return [...operations].reverse().map((operation): EditorModelOperation => {
    if (operation.kind === "add") {
      return { kind: "remove", path: operation.path, before: cloneJson(operation.after) };
    }
    if (operation.kind === "remove") {
      return { kind: "add", path: operation.path, after: cloneJson(operation.before) };
    }
    return {
      kind: "replace",
      path: operation.path,
      before: cloneJson(operation.after),
      after: cloneJson(operation.before),
    };
  });
}

function applyEditorOperation(model: unknown, operation: EditorModelOperation) {
  const root = cloneJson(model);
  const parentPath = operation.path.slice(0, -1);
  const leaf = operation.path.at(-1);
  const parent = parentPath.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[String(segment)];
    }
    return undefined;
  }, root);
  if (parent === undefined || leaf === undefined) return root;
  if (Array.isArray(parent) && typeof leaf === "number") {
    if (operation.kind === "remove") parent.splice(leaf, 1);
    else if (operation.kind === "add") parent.splice(leaf, 0, cloneJson(operation.after));
    else parent[leaf] = cloneJson(operation.after);
    return root;
  }
  if (typeof parent !== "object" || parent === null) return root;
  const record = parent as Record<string, unknown>;
  const key = String(leaf);
  if (operation.kind === "remove") delete record[key];
  else record[key] = cloneJson(operation.after);
  return root;
}

function isJsonContainer(value: unknown) {
  return typeof value === "object" && value !== null;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
